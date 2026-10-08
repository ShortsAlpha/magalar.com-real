export interface VoiceOption {
    id: string;
    name: string;
    gender: 'Male' | 'Female';
    style: string;
    country: string;
}

/** Hard limit enforced by the backend for a single render (single voice or the sum of all dialogue blocks). */
export const MAX_CHARS = 50_000;

export const VOICES: VoiceOption[] = [
    // US English (most popular / versatile)
    { id: 'en-US-AriaNeural', name: 'Aria', gender: 'Female', style: 'Expressive', country: 'US' },
    { id: 'en-US-GuyNeural', name: 'Guy', gender: 'Male', style: 'Neutral', country: 'US' },
    { id: 'en-US-JennyNeural', name: 'Jenny', gender: 'Female', style: 'Balanced', country: 'US' },
    { id: 'en-US-ChristopherNeural', name: 'Christopher', gender: 'Male', style: 'Formal', country: 'US' },
    { id: 'en-US-MichelleNeural', name: 'Michelle', gender: 'Female', style: 'Warm', country: 'US' },
    { id: 'en-US-EricNeural', name: 'Eric', gender: 'Male', style: 'Dynamic', country: 'US' },
    { id: 'en-US-RogerNeural', name: 'Roger', gender: 'Male', style: 'Narrative', country: 'US' },
    { id: 'en-US-SteffanNeural', name: 'Steffan', gender: 'Male', style: 'Youthful', country: 'US' },

    // UK English
    { id: 'en-GB-SoniaNeural', name: 'Sonia', gender: 'Female', style: 'British', country: 'UK' },
    { id: 'en-GB-RyanNeural', name: 'Ryan', gender: 'Male', style: 'British', country: 'UK' },
    { id: 'en-GB-LibbyNeural', name: 'Libby', gender: 'Female', style: 'Proper', country: 'UK' },
    { id: 'en-GB-ThomasNeural', name: 'Thomas', gender: 'Male', style: 'Classic', country: 'UK' },

    // Australian
    { id: 'en-AU-NatashaNeural', name: 'Natasha', gender: 'Female', style: 'Aussie', country: 'AU' },
    { id: 'en-AU-WilliamNeural', name: 'William', gender: 'Male', style: 'Aussie', country: 'AU' },

    // Canada
    { id: 'en-CA-LiamNeural', name: 'Liam', gender: 'Male', style: 'Canadian', country: 'CA' },
    { id: 'en-CA-ClaraNeural', name: 'Clara', gender: 'Female', style: 'Canadian', country: 'CA' },

    // Ireland
    { id: 'en-IE-EmilyNeural', name: 'Emily', gender: 'Female', style: 'Irish', country: 'IE' },
    { id: 'en-IE-ConnorNeural', name: 'Connor', gender: 'Male', style: 'Irish', country: 'IE' },

    // Others
    { id: 'en-US-AnaNeural', name: 'Ana', gender: 'Female', style: 'Child', country: 'US' },
    { id: 'en-US-AndrewNeural', name: 'Andrew', gender: 'Male', style: 'Clear', country: 'US' },
    { id: 'en-US-BrianNeural', name: 'Brian', gender: 'Male', style: 'Deep', country: 'US' },
    { id: 'en-US-EmmaNeural', name: 'Emma', gender: 'Female', style: 'Standard', country: 'US' },
    { id: 'en-US-AvaNeural', name: 'Ava', gender: 'Female', style: 'Soft', country: 'US' },
];

export const DEFAULT_VOICE_ID = 'en-US-AriaNeural';

export function getVoice(id: string): VoiceOption {
    return VOICES.find((v) => v.id === id) ?? VOICES[0];
}
