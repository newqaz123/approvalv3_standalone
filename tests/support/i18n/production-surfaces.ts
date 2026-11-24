export type ProductionSurface = {
  pattern: string
  path: string
  role: 'public' | 'requester' | 'engineer' | 'approver' | 'admin'
  heading: { en: string; th: string } | 'redirect'
}

export const productionSurfaces = [
  { pattern: '/', path: '/', role: 'public', heading: 'redirect' },
  { pattern: '/sign-in/[[...sign-in]]', path: '/sign-in', role: 'public', heading: { en: 'Approval System', th: 'Approval System' } },
  { pattern: '/sign-up/[[...sign-up]]', path: '/sign-up', role: 'public', heading: { en: 'Create Account', th: 'สร้างบัญชี' } },
  { pattern: '/profile', path: '/profile', role: 'requester', heading: { en: 'Profile', th: 'โปรไฟล์' } },
  { pattern: '/change-password', path: '/change-password', role: 'requester', heading: { en: 'Change Password', th: 'เปลี่ยนรหัสผ่าน' } },
  { pattern: '/approval-chain', path: '/approval-chain', role: 'requester', heading: { en: 'Approval Chain', th: 'สายอนุมัติ' } },
  { pattern: '/requests', path: '/requests', role: 'requester', heading: { en: 'Requests', th: 'รายการ Request' } },
  { pattern: '/requests/my-actions', path: '/requests/my-actions', role: 'approver', heading: { en: 'My Action Items', th: 'งานรอคุณอนุมัติ' } },
  { pattern: '/engineering', path: '/engineering', role: 'engineer', heading: { en: 'Engineering Dashboard', th: 'ภาพรวมงานวิศวกรรม' } },
  { pattern: '/dashboard', path: '/dashboard', role: 'requester', heading: { en: 'Improvement Requests — Your department', th: 'Request ปรับปรุงงาน — หน่วยงานของคุณ' } },
  { pattern: '/dashboard/workflow', path: '/dashboard/workflow', role: 'requester', heading: { en: 'Approval Workflow', th: 'ขั้นตอนอนุมัติ' } },
  { pattern: '/analytics', path: '/analytics', role: 'requester', heading: { en: 'Analytics', th: 'วิเคราะห์ข้อมูล' } },
  { pattern: '/budget-monitor', path: '/budget-monitor', role: 'requester', heading: { en: 'Budget Monitor', th: 'ติดตามงบ' } },
  { pattern: '/admin', path: '/admin', role: 'admin', heading: { en: 'Admin Dashboard', th: 'แดชบอร์ดผู้ดูแลระบบ' } },
  { pattern: '/admin/users', path: '/admin/users', role: 'admin', heading: { en: 'Users', th: 'ผู้ใช้' } },
  { pattern: '/admin/organization', path: '/admin/organization', role: 'admin', heading: { en: 'Organization & Approvals', th: 'องค์กรและการอนุมัติ' } },
  { pattern: '/admin/templates', path: '/admin/templates', role: 'admin', heading: { en: 'Request Templates', th: 'เทมเพลต Request' } },
  { pattern: '/admin/templates/new', path: '/admin/templates/new', role: 'admin', heading: { en: 'Create New Template', th: 'สร้างเทมเพลตใหม่' } },
  { pattern: '/admin/templates/[id]', path: '/admin/templates/i18n-coverage-template', role: 'admin', heading: { en: 'Edit Template', th: 'แก้ไขเทมเพลต' } },
  { pattern: '/admin/sub-task-stages', path: '/admin/sub-task-stages', role: 'admin', heading: { en: 'Sub-task stages', th: 'ขั้นตอนงานย่อย' } },
  { pattern: '/admin/storage', path: '/admin/storage', role: 'admin', heading: { en: 'Data storage', th: 'พื้นที่จัดเก็บข้อมูล' } },
  { pattern: '/admin/retention', path: '/admin/retention', role: 'admin', heading: { en: 'Request Retention', th: 'การเก็บรักษา Request' } },
  { pattern: '/admin/email', path: '/admin/email', role: 'admin', heading: { en: 'Email notifications', th: 'การแจ้งเตือนทางอีเมล' } },
  { pattern: '/admin/deleted-requests', path: '/admin/deleted-requests', role: 'admin', heading: { en: 'Deleted Requests', th: 'Request ที่ลบแล้ว' } },
  { pattern: '/admin/audit', path: '/admin/audit', role: 'admin', heading: { en: 'Audit Trail Export', th: 'ส่งออกบันทึก Audit' } },
] as const satisfies readonly ProductionSurface[]

export function productionSurface<Pattern extends typeof productionSurfaces[number]['pattern']>(pattern: Pattern) {
  const surface = productionSurfaces.find((route): route is Extract<typeof productionSurfaces[number], { pattern: Pattern }> => route.pattern === pattern)
  if (!surface) throw new Error(`No production surface for ${pattern}`)
  return surface
}
