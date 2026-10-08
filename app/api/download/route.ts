import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * Authenticated download proxy for renders produced by the voice engine (MP3, SRT/VTT subtitles, DOCX ZIP bundles).
 *
 * The backend uploads to Cloudflare R2 (endpoint `https://<account_id>.r2.cloudflarestorage.com`) and returns a
 * presigned URL. Browsers can't force a download for a cross-origin URL, so we stream it through here with a
 * Content-Disposition header — but only for R2 URLs, never arbitrary hosts (SSRF).
 */

export const dynamic = 'force-dynamic';

const R2_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+r2\.cloudflarestorage\.com$/;

const TYPES = {
    mp3: 'audio/mpeg',
    zip: 'application/zip',
    srt: 'application/x-subrip',
    vtt: 'text/vtt; charset=utf-8',
} as const;

type Ext = keyof typeof TYPES;

function parseAllowedUrl(raw: string | null): URL | null {
    if (!raw) return null;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== '443') return null;
    const host = url.hostname.toLowerCase();
    if (!host.endsWith('.r2.cloudflarestorage.com') || !R2_HOST.test(host)) return null;
    return url;
}

/** ASCII-only, no quotes / CR / LF / path separators, forced .mp3 / .zip / .srt / .vtt extension. */
function sanitizeFilename(raw: string | null): { name: string; ext: Ext } {
    const input = (raw ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
    const base = input.split(/[\\/]/).pop() ?? '';
    const match = /\.(mp3|zip|srt|vtt)\s*$/i.exec(base);
    const ext: Ext = match ? (match[1].toLowerCase() as Ext) : 'mp3';
    const stem = base
        .replace(/\.[^.]*$/, '') // drop any extension the caller supplied
        .replace(/[^A-Za-z0-9 ._-]+/g, '_') // strips quotes, CR/LF, control chars, ;, %, etc.
        .replace(/[ ._-]*_[ ._-]*/g, '_')
        .replace(/^[ ._-]+|[ ._-]+$/g, '')
        .slice(0, 100);
    return { name: `${stem || 'magalar-audio'}.${ext}`, ext };
}

export async function GET(request: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const target = parseAllowedUrl(searchParams.get('url'));
    if (!target) {
        return NextResponse.json({ error: 'Invalid or disallowed url' }, { status: 400 });
    }
    const { name, ext } = sanitizeFilename(searchParams.get('filename'));

    let upstream: Response;
    try {
        upstream = await fetch(target, { redirect: 'error', cache: 'no-store' });
    } catch (error) {
        console.error('Download proxy: upstream fetch failed', error);
        return NextResponse.json({ error: 'Download failed' }, { status: 502 });
    }

    if (!upstream.ok || !upstream.body) {
        // Presigned URLs expire after an hour; surface that as 410 so the UI can say "render again".
        const status = upstream.status === 403 ? 410 : 502;
        return NextResponse.json({ error: status === 410 ? 'Link expired' : 'Download failed' }, { status });
    }

    const headers = new Headers({
        'Content-Type': TYPES[ext],
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    const length = upstream.headers.get('content-length');
    if (length && /^\d+$/.test(length)) headers.set('Content-Length', length);

    // Stream straight through — no buffering of large renders in memory.
    return new Response(upstream.body, { status: 200, headers });
}
