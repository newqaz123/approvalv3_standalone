const en = {
  'common.languageLabel': 'ภาษา / Language',
  'common.languageThai': 'ไทย',
  'common.languageEnglish': 'English',
  'common.status': 'Status',
}

const th = {
  'common.languageLabel': 'ภาษา / Language',
  'common.languageThai': 'ไทย',
  'common.languageEnglish': 'English',
  'common.status': 'สถานะ',
} satisfies Record<keyof typeof en, string>

export const common = { en, th }
