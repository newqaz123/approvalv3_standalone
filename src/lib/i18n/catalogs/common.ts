const en = {
  'common.languageLabel': 'ภาษา / Language',
  'common.languageThai': 'ไทย',
  'common.languageEnglish': 'English',
  'common.status': 'Status',
  'common.cancel': 'Cancel',
  'common.saving': 'Saving...',
  'common.languageSaveFailed': 'Could not save the language. Try again.',
  'common.languageRetry': 'Try again',
}

const th = {
  'common.languageLabel': 'ภาษา / Language',
  'common.languageThai': 'ไทย',
  'common.languageEnglish': 'English',
  'common.status': 'สถานะ',
  'common.cancel': 'ยกเลิก',
  'common.saving': 'กำลังบันทึก...',
  'common.languageSaveFailed': 'บันทึกภาษาไม่ได้ ลองอีกครั้ง',
  'common.languageRetry': 'ลองอีกครั้ง',
} satisfies Record<keyof typeof en, string>

export const common = { en, th }
