export interface TajweedRuleInfo {
  id: 'ith-har' | 'idgham_ghunnah' | 'idgham_bighunnah' | 'iqlab' | 'ikhfa';
  name: string;
  shortName: string;
  category: string;
  letters: string[];
  lettersVerse: string;
  lettersCount: number;
  definition: string;
  howToPronounce: string;
  ghunnah: string;
  colorTheme: 'emerald' | 'royal' | 'amber' | 'purple';
  badgeClass: string;
  examples: {
    noonOneWord?: string;
    noonTwoWords: string;
    tanween: string;
  };
  sampleChars: string[];
  quranicWords: string[];
}

export const NOON_SAKINAH_RULES: Record<string, TajweedRuleInfo> = {
  'ith-har': {
    id: 'ith-har',
    name: 'الإظهار الحلقي',
    shortName: 'إظهار',
    category: 'إخراج كل حرف من مخرجه من غير غنة زائدة',
    letters: ['ء', 'هـ', 'ع', 'ح', 'غ', 'خ'],
    lettersVerse: 'همزٌ فهاءٌ ثم عينٌ حاءُ .. مهملتان ثم غينٌ خاءُ',
    lettersCount: 6,
    definition: 'نطق النون الساكنة أو التنوين واضحة جلية بدون غنة زائدة إذا جاء بعدها أحد حروف الحلق الستة.',
    howToPronounce: 'انطق النون بلسانك طبيعياً دون مد أو غنة طويلة، ثم انطق حرف الحلق بعده مباشرة.',
    ghunnah: 'بدون غنة ممدودة (أصل الغنة فقط)',
    colorTheme: 'emerald',
    badgeClass: 'theme-emerald',
    examples: {
      noonOneWord: 'يَنْأَوْنَ / أَنْعَمْتَ',
      noonTwoWords: 'مَنْ آمَنَ / مِنْ حَكِيمٍ',
      tanween: 'عَلِيمٌ حَكِيمٌ / قَوْمًا هَادٍ',
    },
    sampleChars: ['ء', 'هـ', 'ع', 'ح', 'غ', 'خ'],
    quranicWords: ['مَنْ آمَنَ', 'أَنْعَمْتَ', 'عَلِيمٌ حَكِيمٌ'],
  },
  'idgham_ghunnah': {
    id: 'idgham_ghunnah',
    name: 'الإدغام بغُنّة',
    shortName: 'إدغام بغنة',
    category: 'إدخال النون في الحرف التالي مع صوت الغنة الرنان',
    letters: ['ي', 'ن', 'م', 'و'],
    lettersVerse: 'مجموعة في كلمة: (يَنْمُو)',
    lettersCount: 4,
    definition: 'دمج النون الساكنة أو التنوين في الحرف التالي بحيث يصيران حرفاً واحداً مشدداً مصحوباً بغنة بمقدار حركتين.',
    howToPronounce: 'ادمج صوت النون في الحرف التالي مع إخراج غنة رنانة من الخيشوم (الأنف) لمدة حركتين.',
    ghunnah: 'غنة كاملة بمقدار حركتين (تخرج من الخيشوم)',
    colorTheme: 'royal',
    badgeClass: 'theme-sky',
    examples: {
      noonTwoWords: 'مَن يَقُولُ / مِن وَالٍ',
      tanween: 'وُجُوهٌ يَوْمَئِذٍ / رَحِيمٌ وَدُودٌ',
    },
    sampleChars: ['ي', 'ن', 'م', 'و'],
    quranicWords: ['مَن يَقُولُ', 'مِن وَالٍ', 'وُجُوهٌ يَوْمَئِذٍ'],
  },
  'idgham_bighunnah': {
    id: 'idgham_bighunnah',
    name: 'الإدغام بغير غُنّة (الكامل)',
    shortName: 'إدغام كامل',
    category: 'إدخال النون بالكامل دون بقاء أي أثر لصوت الغنة',
    letters: ['ر', 'ل'],
    lettersVerse: 'حرفا: (الراء واللام)',
    lettersCount: 2,
    definition: 'إدماج النون الساكنة أو التنوين في اللام أو الراء إدماجاً تاماً بدون أي صوت للغنة.',
    howToPronounce: 'انتقل مباشرة إلى اللام أو الراء مشددتين بقوة وسرعة دون حبس صوت في الأنف.',
    ghunnah: 'بدون غنة على الإطلاق (إدغام تام)',
    colorTheme: 'royal',
    badgeClass: 'theme-sky',
    examples: {
      noonTwoWords: 'مِن رَّبِّهِمْ / مِن لَّدُنْهُ',
      tanween: 'هُدًى لِّلْمُتَّقِينَ / غَفُورٌ رَّحِيمٌ',
    },
    sampleChars: ['ر', 'ل'],
    quranicWords: ['مِن رَّبِّهِمْ', 'مِن لَّدُنْكَ', 'غَفُورٌ رَّحِيمٌ'],
  },
  'iqlab': {
    id: 'iqlab',
    name: 'الإقلاب (القلب)',
    shortName: 'إقلاب',
    category: 'قلب النون الساكنة أو التنوين إلى ميم مخفاة بغنة',
    letters: ['ب'],
    lettersVerse: 'حرف واحد فقط: (الباء)',
    lettersCount: 1,
    definition: 'تحويل النون الساكنة أو التنوين إلى ميم ساكنة مخفاة مع بقاء الغنة بمقدار حركتين عند ملاقاة حرف الباء (ويُرسم ميم صغيرة فوقها ۘ).',
    howToPronounce: 'أغلق الشفتين برفق خفيف بدون ضغط شديد لنطق الميم مع غنة رنانة قبل نطق الباء.',
    ghunnah: 'غنة ظاهرة بمقدار حركتين مع الميم المقلوبة',
    colorTheme: 'amber',
    badgeClass: 'theme-amber',
    examples: {
      noonOneWord: 'أَنۢبِئْهُم / لَيُنۢبَذَنَّ',
      noonTwoWords: 'مِنۢ بَعْدِ / أَنۢ بُورِكَ',
      tanween: 'سَمِيعٌۢ بَصِيرٌ / زَوْجٍۢ بَهِيجٍ',
    },
    sampleChars: ['ب'],
    quranicWords: ['مِنۢ بَعْدِ', 'أَنۢبِئْهُم', 'سَمِيعٌۢ بَصِيرٌ'],
  },
  'ikhfa': {
    id: 'ikhfa',
    name: 'الإخفاء الحقيقي',
    shortName: 'إخفاء',
    category: 'ستر صوت النون بين الإظهار والإدغام مع الغنة',
    letters: ['ص', 'ذ', 'ث', 'ك', 'ج', 'ش', 'ق', 'س', 'د', 'ط', 'ز', 'ف', 'ت', 'ض', 'ظ'],
    lettersVerse: 'صِفْ ذَا ثَنَا كَمْ جَادَ شَخْصٌ قَدْ سَمَا .. دُمْ طَيِّبًا زِدْ فِي تُقًى ضَعْ ظَالِمَا',
    lettersCount: 15,
    definition: 'نطق النون الساكنة أو التنوين بحالة متوسطة بين الإظهار والإدغام عارية عن التشديد مع بقاء الغنة بمقدار حركتين.',
    howToPronounce: 'هيئ فمك على مخرج الحرف التالي واحبس جزءاً من الهواء في الخيشوم لإخراج الغنة دون إلصاق اللسان بالحنك.',
    ghunnah: 'غنة مرققة أو مفخمة تتبع الحرف الذي بعدها (حركتان)',
    colorTheme: 'purple',
    badgeClass: 'theme-purple',
    examples: {
      noonOneWord: 'مَنثُورًا / أَنزَلَ / يُنفِقُونَ',
      noonTwoWords: 'مَن كَانَ / مِن طِينٍ / إِن شَاءَ',
      tanween: 'قَوْلًا سَدِيدًا / شَيْءٍ قَدِيرٌ / كِتَابٌ كَرِيمٌ',
    },
    sampleChars: ['ص', 'ذ', 'ث', 'ك', 'ج', 'ش', 'ق', 'س', 'د', 'ط', 'ز', 'ف', 'ت', 'ض', 'ظ'],
    quranicWords: ['مَنثُورًا', 'مِن طِينٍ', 'قَوْلًا سَدِيدًا'],
  },
};

export interface NoonWordQuizItem {
  word: string;
  ruleId: 'ith-har' | 'idgham_ghunnah' | 'idgham_bighunnah' | 'iqlab' | 'ikhfa';
  ruleName: string;
  ruleLetter: string;
  explanation: string;
  type: 'نون ساكنة' | 'تنوين';
}

export const NOON_WORDS_QUIZ_BANK: NoonWordQuizItem[] = [
  {
    word: 'مَنْ آمَنَ',
    ruleId: 'ith-har',
    ruleName: 'إظهار حلقي',
    ruleLetter: 'ء',
    explanation: 'نون ساكنة بعدها همزة (ء) في كلمتين، وهو من حروف الحلق الستة.',
    type: 'نون ساكنة',
  },
  {
    word: 'مَن يَقُولُ',
    ruleId: 'idgham_ghunnah',
    ruleName: 'إدغام بغنة',
    ruleLetter: 'ي',
    explanation: 'نون ساكنة بعدها ياء (ي)، والياء من حروف (ينمو) مع الغنة.',
    type: 'نون ساكنة',
  },
  {
    word: 'مِنۢ بَعْدِ',
    ruleId: 'iqlab',
    ruleName: 'إقلاب',
    ruleLetter: 'ب',
    explanation: 'نون ساكنة بعدها باء (ب)، فتقلب النون الساكنة إلى ميم مخفاة بغنة.',
    type: 'نون ساكنة',
  },
  {
    word: 'مِن طِينٍ',
    ruleId: 'ikhfa',
    ruleName: 'إخفاء حقيقي',
    ruleLetter: 'ط',
    explanation: 'نون ساكنة بعدها طاء (ط)، والطاء من حروف الإخفاء الـ ١٥ (وغنتها مفخمة).',
    type: 'نون ساكنة',
  },
  {
    word: 'مِن رَّبِّهِمْ',
    ruleId: 'idgham_bighunnah',
    ruleName: 'إدغام بغير غنة',
    ruleLetter: 'ر',
    explanation: 'نون ساكنة بعدها راء (ر)، فيكون الإدغام كاملاً بغير غنة.',
    type: 'نون ساكنة',
  },
  {
    word: 'عَلِيمٌ حَكِيمٌ',
    ruleId: 'ith-har',
    ruleName: 'إظهار حلقي',
    ruleLetter: 'ح',
    explanation: 'تنوين ضمة بعده حاء (ح)، والحاء من حروف الحلق الستة.',
    type: 'تنوين',
  },
  {
    word: 'أَنۢبِئْهُم',
    ruleId: 'iqlab',
    ruleName: 'إقلاب',
    ruleLetter: 'ب',
    explanation: 'نون ساكنة بعدها باء (ب) في كلمة واحدة، قلبت ميماً مخفاة بغنة.',
    type: 'نون ساكنة',
  },
  {
    word: 'قَوْلًا سَدِيدًا',
    ruleId: 'ikhfa',
    ruleName: 'إخفاء حقيقي',
    ruleLetter: 'س',
    explanation: 'تنوين فتح بعده سين (س)، والسين من حروف الإخفاء الحقيقي.',
    type: 'تنوين',
  },
  {
    word: 'هُدًى لِّلْمُتَّقِينَ',
    ruleId: 'idgham_bighunnah',
    ruleName: 'إدغام بغير غنة',
    ruleLetter: 'ل',
    explanation: 'تنوين فتح بعده لام (ل)، فيكون إدغاماً كاملاً بغير غنة.',
    type: 'تنوين',
  },
  {
    word: 'وُجُوهٌ يَوْمَئِذٍ',
    ruleId: 'idgham_ghunnah',
    ruleName: 'إدغام بغنة',
    ruleLetter: 'ي',
    explanation: 'تنوين ضمة بعده ياء (ي) في بداية الكلمة التالية بغنة.',
    type: 'تنوين',
  },
  {
    word: 'أَنْعَمْتَ',
    ruleId: 'ith-har',
    ruleName: 'إظهار حلقي',
    ruleLetter: 'ع',
    explanation: 'نون ساكنة بعدها عين (ع) في كلمة واحدة، والعين من حروف الحلق.',
    type: 'نون ساكنة',
  },
  {
    word: 'مَنثُورًا',
    ruleId: 'ikhfa',
    ruleName: 'إخفاء حقيقي',
    ruleLetter: 'ث',
    explanation: 'نون ساكنة بعدها ثاء (ث) في كلمة واحدة، حكمها الإخفاء.',
    type: 'نون ساكنة',
  },
  {
    word: 'سَمِيعٌۢ بَصِيرٌ',
    ruleId: 'iqlab',
    ruleName: 'إقلاب',
    ruleLetter: 'ب',
    explanation: 'تنوين ضمة بعده باء (ب)، فقلب التنوين إلى ميم مخفاة بغنة.',
    type: 'تنوين',
  },
  {
    word: 'مِن وَالٍ',
    ruleId: 'idgham_ghunnah',
    ruleName: 'إدغام بغنة',
    ruleLetter: 'و',
    explanation: 'نون ساكنة بعدها واو (و) من حروف (ينمو) مع الغنة.',
    type: 'نون ساكنة',
  },
  {
    word: 'شَيْءٍ قَدِيرٌ',
    ruleId: 'ikhfa',
    ruleName: 'إخفاء حقيقي',
    ruleLetter: 'ق',
    explanation: 'تنوين كسر بعده قاف (ق)، والتاء والقاف من حروف الإخفاء الحقيقي.',
    type: 'تنوين',
  },
];

export interface NoonSakinahAyahCase {
  textSnippet: string;
  ruleId: 'ith-har' | 'idgham_ghunnah' | 'idgham_bighunnah' | 'iqlab' | 'ikhfa';
  ruleName: string;
  letter: string;
  type: string;
}

export interface NoonSurahData {
  name: string;
  ayat: string[];
  cases: Record<number, NoonSakinahAyahCase[]>;
}

export const NOON_SURAHS: Record<string, NoonSurahData> = {
  'الإخلاص': {
    name: 'سورة الإخلاص',
    ayat: [
      'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
      'قُلْ هُوَ اللَّهُ أَحَدٌ',
      'اللَّهُ الصَّمَدُ',
      'لَمْ يَلِدْ وَلَمْ يُولَدْ',
      'وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ',
    ],
    cases: {
      4: [
        { textSnippet: 'يَكُن لَّهُ', ruleId: 'idgham_bighunnah', ruleName: 'إدغام بغير غنة', letter: 'ل', type: 'نون ساكنة بعدها لام' },
        { textSnippet: 'كُفُوًا أَحَدٌ', ruleId: 'ith-har', ruleName: 'إظهار حلقي', letter: 'ء', type: 'تنوين بعده همزة' },
      ],
    },
  },
  'الفلق': {
    name: 'سورة الفلق',
    ayat: [
      'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
      'قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ',
      'مِن شَرِّ مَا خَلَقَ',
      'وَمِن شَرِّ غَاسِقٍ إِذَا وَقَبَ',
      'وَمِن شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ',
      'وَمِن شَرِّ حَاسِدٍ إِذَا حَسَدَ',
    ],
    cases: {
      2: [
        { textSnippet: 'مِن شَرِّ', ruleId: 'ikhfa', ruleName: 'إخفاء حقيقي', letter: 'ش', type: 'نون ساكنة بعدها شين' },
      ],
      3: [
        { textSnippet: 'وَمِن شَرِّ', ruleId: 'ikhfa', ruleName: 'إخفاء حقيقي', letter: 'ش', type: 'نون ساكنة بعدها شين' },
        { textSnippet: 'غَاسِقٍ إِذَا', ruleId: 'ith-har', ruleName: 'إظهار حلقي', letter: 'ء', type: 'تنوين كسر بعده همزة' },
      ],
      4: [
        { textSnippet: 'وَمِن شَرِّ', ruleId: 'ikhfa', ruleName: 'إخفاء حقيقي', letter: 'ش', type: 'نون ساكنة بعدها شين' },
      ],
      5: [
        { textSnippet: 'وَمِن شَرِّ', ruleId: 'ikhfa', ruleName: 'إخفاء حقيقي', letter: 'ش', type: 'نون ساكنة بعدها شين' },
        { textSnippet: 'حَاسِدٍ إِذَا', ruleId: 'ith-har', ruleName: 'إظهار حلقي', letter: 'ء', type: 'تنوين كسر بعده همزة' },
      ],
    },
  },
  'المسد': {
    name: 'سورة المسد',
    ayat: [
      'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
      'تَبَّتْ يَدَا أَبِي لَهَبٍ وَتَبَّ',
      'مَا أَغْنَىٰ عَنْهُ مَالُهُ وَمَا كَسَبَ',
      'سَيَصْلَىٰ نَارًا ذَاتَ لَهَبٍ',
      'وَامْرَأَتُهُ حَمَّالَةَ الْحَطَبِ',
      'فِي جِيدِهَا حَبْلٌ مِّن مَّسَدٍ',
    ],
    cases: {
      1: [
        { textSnippet: 'لَهَبٍ وَتَبَّ', ruleId: 'idgham_ghunnah', ruleName: 'إدغام بغنة', letter: 'و', type: 'تنوين بعده واو' },
      ],
      2: [
        { textSnippet: 'عَنْهُ', ruleId: 'ith-har', ruleName: 'إظهار حلقي', letter: 'هـ', type: 'نون ساكنة بعدها هاء' },
      ],
      3: [
        { textSnippet: 'نَارًا ذَاتَ', ruleId: 'ikhfa', ruleName: 'إخفاء حقيقي', letter: 'ذ', type: 'تنوين فتح بعده ذال' },
      ],
      5: [
        { textSnippet: 'حَبْلٌ مِّن', ruleId: 'idgham_ghunnah', ruleName: 'إدغام بغنة', letter: 'م', type: 'تنوين بعده ميم' },
        { textSnippet: 'مِّن مَّسَدٍ', ruleId: 'idgham_ghunnah', ruleName: 'إدغام بغنة', letter: 'م', type: 'نون ساكنة بعدها ميم' },
      ],
    },
  },
  'الكوثر': {
    name: 'سورة الكوثر',
    ayat: [
      'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
      'إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ',
      'فَصَلِّ لِرَبِّكَ وَانْحَرْ',
      'إِنَّ شَانِئَكَ هُوَ الْأَبْتَرُ',
    ],
    cases: {
      2: [
        { textSnippet: 'وَانْحَرْ', ruleId: 'ith-har', ruleName: 'إظهار حلقي', letter: 'ح', type: 'نون ساكنة بعدها حاء' },
      ],
    },
  },
  'قريش': {
    name: 'سورة قريش',
    ayat: [
      'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
      'لِإِيلَافِ قُرَيْشٍ',
      'إِيلَافِهِمْ رِحْلَةَ الشِّتَاءِ وَالصَّيْفِ',
      'فَلْيَعْبُدُوا رَبَّ هَٰذَا الْبَيْتِ',
      'الَّذِي أَطْعَمَهُم مِّن جُوعٍ وَآمَنَهُم مِّنْ خَوْفٍ',
    ],
    cases: {
      4: [
        { textSnippet: 'مِّن جُوعٍ', ruleId: 'ikhfa', ruleName: 'إخفاء حقيقي', letter: 'ج', type: 'نون ساكنة بعدها جيم' },
        { textSnippet: 'جُوعٍ وَآمَنَهُم', ruleId: 'idgham_ghunnah', ruleName: 'إدغام بغنة', letter: 'و', type: 'تنوين بعده واو' },
        { textSnippet: 'مِّنْ خَوْفٍ', ruleId: 'ith-har', ruleName: 'إظهار حلقي', letter: 'خ', type: 'نون ساكنة بعدها خاء' },
      ],
    },
  },
  'الزلزلة': {
    name: 'سورة الزلزلة',
    ayat: [
      'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
      'إِذَا زُلْزِلَتِ الْأَرْضُ زِلْزَالَهَا',
      'وَأَخْرَجَتِ الْأَرْضُ أَثْقَالَهَا',
      'وَقَالَ الْإِنسَانُ مَا لَهَا',
      'يَوْمَئِذٍ تُحَدِّثُ أَخْبَارَهَا',
      'بِأَنَّ رَبَّكَ أَوْحَىٰ لَهَا',
      'يَوْمَئِذٍ يَصْدُرُ النَّاسُ أَشْتَاتًا لِّيُرَوْا أَعْمَالَهُمْ',
      'فَمَن يَعْمَلْ مِثْقَالَ ذَرَّةٍ خَيْرًا يَرَهُ',
      'وَمَن يَعْمَلْ مِثْقَالَ ذَرَّةٍ شَرًّا يَرَهُ',
    ],
    cases: {
      3: [
        { textSnippet: 'الْإِنسَانُ', ruleId: 'ikhfa', ruleName: 'إخفاء حقيقي', letter: 'س', type: 'نون ساكنة بعدها سين' },
      ],
      4: [
        { textSnippet: 'يَوْمَئِذٍ تُحَدِّثُ', ruleId: 'ikhfa', ruleName: 'إخفاء حقيقي', letter: 'ت', type: 'تنوين كسر بعده تاء' },
      ],
      6: [
        { textSnippet: 'يَوْمَئِذٍ يَصْدُرُ', ruleId: 'idgham_ghunnah', ruleName: 'إدغام بغنة', letter: 'ي', type: 'تنوين بعده ياء' },
        { textSnippet: 'أَشْتَاتًا لِّيُرَوْا', ruleId: 'idgham_bighunnah', ruleName: 'إدغام بغير غنة', letter: 'ل', type: 'تنوين بعده لام' },
      ],
      7: [
        { textSnippet: 'فَمَن يَعْمَلْ', ruleId: 'idgham_ghunnah', ruleName: 'إدغام بغنة', letter: 'ي', type: 'نون ساكنة بعدها ياء' },
        { textSnippet: 'ذَرَّةٍ خَيْرًا', ruleId: 'ith-har', ruleName: 'إظهار حلقي', letter: 'خ', type: 'تنوين كسر بعده خاء' },
        { textSnippet: 'خَيْرًا يَرَهُ', ruleId: 'idgham_ghunnah', ruleName: 'إدغام بغنة', letter: 'ي', type: 'تنوين فتح بعده ياء' },
      ],
      8: [
        { textSnippet: 'وَمَن يَعْمَلْ', ruleId: 'idgham_ghunnah', ruleName: 'إدغام بغنة', letter: 'ي', type: 'نون ساكنة بعدها ياء' },
        { textSnippet: 'ذَرَّةٍ شَرًّا', ruleId: 'ikhfa', ruleName: 'إخفاء حقيقي', letter: 'ش', type: 'تنوين كسر بعده شين' },
        { textSnippet: 'شَرًّا يَرَهُ', ruleId: 'idgham_ghunnah', ruleName: 'إدغام بغنة', letter: 'ي', type: 'تنوين فتح بعده ياء' },
      ],
    },
  },
};
