/**
 * Supported transcription languages configuration.
 * This is the single source of truth for language options across the application.
 *
 * Includes all 99 languages supported by Whisper 'small' model plus auto-detect.
 */
export const SUPPORTED_LANGUAGES = [
  // Auto-detect option (first for visibility)
  { code: 'auto', name: 'Auto-detect', native: 'Auto', enabled: true },

  // Major languages (sorted by global usage)
  { code: 'en', name: 'English', native: 'English', enabled: true },
  { code: 'zh', name: 'Chinese', native: '中文', enabled: true },
  { code: 'es', name: 'Spanish', native: 'Español', enabled: true },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', enabled: true },
  { code: 'ar', name: 'Arabic', native: 'العربية', enabled: true },
  { code: 'pt', name: 'Portuguese', native: 'Português', enabled: true },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', enabled: true },
  { code: 'ru', name: 'Russian', native: 'Русский', enabled: true },
  { code: 'ja', name: 'Japanese', native: '日本語', enabled: true },
  { code: 'de', name: 'German', native: 'Deutsch', enabled: true },
  { code: 'fr', name: 'French', native: 'Français', enabled: true },
  { code: 'ko', name: 'Korean', native: '한국어', enabled: true },
  { code: 'it', name: 'Italian', native: 'Italiano', enabled: true },
  { code: 'tr', name: 'Turkish', native: 'Türkçe', enabled: true },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', enabled: true },
  { code: 'pl', name: 'Polish', native: 'Polski', enabled: true },
  { code: 'uk', name: 'Ukrainian', native: 'Українська', enabled: true },
  { code: 'nl', name: 'Dutch', native: 'Nederlands', enabled: true },
  { code: 'th', name: 'Thai', native: 'ไทย', enabled: true },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', enabled: true },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu', enabled: true },
  { code: 'fa', name: 'Persian', native: 'فارسی', enabled: true },
  { code: 'he', name: 'Hebrew', native: 'עברית', enabled: true },
  { code: 'el', name: 'Greek', native: 'Ελληνικά', enabled: true },
  { code: 'cs', name: 'Czech', native: 'Čeština', enabled: true },
  { code: 'sv', name: 'Swedish', native: 'Svenska', enabled: true },
  { code: 'ro', name: 'Romanian', native: 'Română', enabled: true },
  { code: 'hu', name: 'Hungarian', native: 'Magyar', enabled: true },
  { code: 'da', name: 'Danish', native: 'Dansk', enabled: true },
  { code: 'fi', name: 'Finnish', native: 'Suomi', enabled: true },
  { code: 'no', name: 'Norwegian', native: 'Norsk', enabled: true },
  { code: 'sk', name: 'Slovak', native: 'Slovenčina', enabled: true },
  { code: 'hr', name: 'Croatian', native: 'Hrvatski', enabled: true },
  { code: 'bg', name: 'Bulgarian', native: 'Български', enabled: true },
  { code: 'sr', name: 'Serbian', native: 'Српски', enabled: true },
  { code: 'sl', name: 'Slovenian', native: 'Slovenščina', enabled: true },
  { code: 'lt', name: 'Lithuanian', native: 'Lietuvių', enabled: true },
  { code: 'lv', name: 'Latvian', native: 'Latviešu', enabled: true },
  { code: 'et', name: 'Estonian', native: 'Eesti', enabled: true },
  { code: 'ca', name: 'Catalan', native: 'Català', enabled: true },
  { code: 'eu', name: 'Basque', native: 'Euskara', enabled: true },
  { code: 'gl', name: 'Galician', native: 'Galego', enabled: true },
  { code: 'cy', name: 'Welsh', native: 'Cymraeg', enabled: true },
  { code: 'is', name: 'Icelandic', native: 'Íslenska', enabled: true },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', enabled: true },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', enabled: true },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', enabled: true },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', enabled: true },
  { code: 'mr', name: 'Marathi', native: 'मराठी', enabled: true },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', enabled: true },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', enabled: true },
  { code: 'ur', name: 'Urdu', native: 'اردو', enabled: true },
  { code: 'ne', name: 'Nepali', native: 'नेपाली', enabled: true },
  { code: 'si', name: 'Sinhala', native: 'සිංහල', enabled: true },
  { code: 'my', name: 'Myanmar', native: 'မြန်မာ', enabled: true },
  { code: 'km', name: 'Khmer', native: 'ខ្មែរ', enabled: true },
  { code: 'lo', name: 'Lao', native: 'ລາວ', enabled: true },
  { code: 'ka', name: 'Georgian', native: 'ქართული', enabled: true },
  { code: 'hy', name: 'Armenian', native: 'Hayeren', enabled: true },
  { code: 'az', name: 'Azerbaijani', native: 'Azərbaycan', enabled: true },
  { code: 'kk', name: 'Kazakh', native: 'Қазақ', enabled: true },
  { code: 'uz', name: 'Uzbek', native: 'Oʻzbek', enabled: true },
  { code: 'tg', name: 'Tajik', native: 'Тоҷикӣ', enabled: true },
  { code: 'tk', name: 'Turkmen', native: 'Türkmen', enabled: true },
  { code: 'mn', name: 'Mongolian', native: 'Монгол', enabled: true },
  { code: 'bo', name: 'Tibetan', native: 'བོད་སྐད', enabled: true },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili', enabled: true },
  { code: 'am', name: 'Amharic', native: 'አማርኛ', enabled: true },
  { code: 'yo', name: 'Yoruba', native: 'Yorùbá', enabled: true },
  { code: 'ha', name: 'Hausa', native: 'Hausa', enabled: true },
  { code: 'sn', name: 'Shona', native: 'ChiShona', enabled: true },
  { code: 'so', name: 'Somali', native: 'Soomaali', enabled: true },
  { code: 'af', name: 'Afrikaans', native: 'Afrikaans', enabled: true },
  { code: 'tl', name: 'Tagalog', native: 'Tagalog', enabled: true },
  { code: 'jw', name: 'Javanese', native: 'Basa Jawa', enabled: true },
  { code: 'su', name: 'Sundanese', native: 'Basa Sunda', enabled: true },
  { code: 'mi', name: 'Maori', native: 'Te Reo Māori', enabled: true },
  { code: 'haw', name: 'Hawaiian', native: 'ʻŌlelo Hawaiʻi', enabled: true },
  { code: 'la', name: 'Latin', native: 'Latina', enabled: true },
  { code: 'sa', name: 'Sanskrit', native: 'संस्कृतम्', enabled: true },
  { code: 'yi', name: 'Yiddish', native: 'ייִדיש', enabled: true },
  { code: 'lb', name: 'Luxembourgish', native: 'Lëtzebuergesch', enabled: true },
  { code: 'mt', name: 'Maltese', native: 'Malti', enabled: true },
  { code: 'oc', name: 'Occitan', native: 'Occitan', enabled: true },
  { code: 'br', name: 'Breton', native: 'Brezhoneg', enabled: true },
  { code: 'fo', name: 'Faroese', native: 'Føroyskt', enabled: true },
  { code: 'nn', name: 'Nynorsk', native: 'Nynorsk', enabled: true },
  { code: 'bs', name: 'Bosnian', native: 'Bosanski', enabled: true },
  { code: 'mk', name: 'Macedonian', native: 'Македонски', enabled: true },
  { code: 'sq', name: 'Albanian', native: 'Shqip', enabled: true },
  { code: 'be', name: 'Belarusian', native: 'Беларуская', enabled: true },
  { code: 'ht', name: 'Haitian Creole', native: 'Kreyòl Ayisyen', enabled: true },
  { code: 'ps', name: 'Pashto', native: 'پښتو', enabled: true },
  { code: 'sd', name: 'Sindhi', native: 'سنڌي', enabled: true },
  { code: 'as', name: 'Assamese', native: 'অসমীয়া', enabled: true },
  { code: 'tt', name: 'Tatar', native: 'Татар', enabled: true },
  { code: 'ba', name: 'Bashkir', native: 'Башҡорт', enabled: true },
  { code: 'ln', name: 'Lingala', native: 'Lingála', enabled: true },
  { code: 'mg', name: 'Malagasy', native: 'Malagasy', enabled: true },
] as const;

/**
 * Type-safe language code derived from SUPPORTED_LANGUAGES
 */
export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

/**
 * Returns only languages that are currently enabled for use
 */
export const getEnabledLanguages = () => SUPPORTED_LANGUAGES.filter((lang) => lang.enabled);

/**
 * Get language name by code
 */
export const getLanguageName = (code: string): string => {
  const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
  return lang?.name || code;
};

/**
 * Get native language name by code
 */
export const getNativeLanguageName = (code: string): string => {
  const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
  return lang?.native || lang?.name || code;
};

/**
 * Check if a language code is valid
 */
export const isValidLanguageCode = (code: string): code is LanguageCode => {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code);
};

/**
 * Check if a language code is the auto-detect option
 */
export const isAutoDetect = (code: string): boolean => code === 'auto';
