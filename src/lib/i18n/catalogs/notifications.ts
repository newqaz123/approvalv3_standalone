export const notifications = {
  en: {
    'notifications.heading': 'Notifications',
    'notifications.unread': 'Notifications, {count} unread',
    'notifications.loading': 'Loading...',
    'notifications.empty': 'No notifications',
    'notifications.markAllRead': 'Mark all as read',
    'notifications.markedAllRead': 'Marked {count} notifications as read',
    'notifications.loadFailed': 'Failed to load notifications',
    'notifications.markReadFailed': 'Failed to mark notification as read',
    'notifications.markAllReadFailed': 'Failed to mark all as read',
    'notifications.request': 'Request: {title}',
  },
  th: {
    'notifications.heading': 'การแจ้งเตือน',
    'notifications.unread': 'การแจ้งเตือน ยังไม่ได้อ่าน {count} รายการ',
    'notifications.loading': 'กำลังโหลด...',
    'notifications.empty': 'ไม่มีการแจ้งเตือน',
    'notifications.markAllRead': 'ทำเครื่องหมายว่าอ่านแล้วทั้งหมด',
    'notifications.markedAllRead': 'ทำเครื่องหมายว่าอ่านแล้ว {count} รายการ',
    'notifications.loadFailed': 'ยังโหลดการแจ้งเตือนไม่ได้ ลองอีกครั้ง',
    'notifications.markReadFailed': 'ยังทำเครื่องหมายว่าอ่านแล้วไม่ได้ ลองอีกครั้ง',
    'notifications.markAllReadFailed': 'ยังทำเครื่องหมายว่าอ่านแล้วทั้งหมดไม่ได้ ลองอีกครั้ง',
    'notifications.request': 'Request: {title}',
  },
}

export const notificationDisplayTemplates = {
  requestSubmitted: {
    en: ['New Approval Request', '📋 New Approval Request: "{requestTitle}" requires your approval.'],
    th: ['Request ใหม่รอคุณอนุมัติ', '📋 Request "{requestTitle}" รอคุณอนุมัติ'],
  },
  requestApprovalNeeded: {
    en: ['Approval Needed', 'Request "{requestTitle}" needs your approval'],
    th: ['Request รอคุณอนุมัติ', 'Request "{requestTitle}" รอคุณอนุมัติ'],
  },
  finalApprovalNeededFromRequest: {
    en: ['Approval Needed', 'Request "{requestTitle}" needs your approval'],
    th: ['รอคุณอนุมัติรอบ Final', 'Request "{requestTitle}" รอคุณอนุมัติรอบ Final'],
  },
  requestRejected: {
    en: ['Request Rejected', '❌ Request Rejected: Your request "{requestTitle}" has been rejected. Reason: "{reason}"'],
    th: ['ไม่อนุมัติ Request', '❌ ไม่อนุมัติ Request "{requestTitle}" เหตุผล: "{reason}"'],
  },
  requestStatusChanged: {
    en: ['Request Status Changed', 'Your request status changed to {status}'],
    th: ['สถานะ Request เปลี่ยนแล้ว', 'สถานะ Request ของคุณเปลี่ยนเป็น {status}'],
  },
  requestAssigned: {
    en: ['PIC Assignment', '👤 PIC Assignment: You have been assigned to "{requestTitle}". Please review and submit your solution.'],
    th: ['คุณได้รับมอบหมาย Request', '👤 คุณได้รับมอบหมายให้ดูแล "{requestTitle}" โปรดตรวจสอบและส่ง Solution'],
  },
  solutionSubmitted: {
    en: ['Solution Submitted for Approval', '📤 Solution Submitted: "{requestTitle}" has a new solution ready for your approval.'],
    th: ['ส่ง Solution ให้คุณอนุมัติ', '📤 Solution ใหม่ของ "{requestTitle}" รอคุณอนุมัติ'],
  },
  solutionAutoReady: {
    en: ['Solution Ready for Review', 'Engineering solution for "{requestTitle}" is ready for your review.'],
    th: ['Solution พร้อมให้ตรวจสอบ', 'Solution จากทีม Engineering สำหรับ "{requestTitle}" พร้อมให้คุณตรวจสอบ'],
  },
  solutionReady: {
    en: ['Solution Ready for Review', '📤 Ready for Review: "{requestTitle}" has been completed and awaits your department\'s final review.'],
    th: ['Solution พร้อมให้ตรวจสอบ', '📤 Solution ของ "{requestTitle}" เสร็จแล้ว รอให้หน่วยงานของคุณตรวจสอบรอบ Final'],
  },
  solutionRejected: {
    en: ['Solution Rejected', '❌ Solution Rejected: "{solutionTitle}" was rejected and returned to engineering for revision. Reason: "{reason}"'],
    th: ['ไม่อนุมัติ Solution', '❌ ไม่อนุมัติ Solution "{solutionTitle}" และส่งกลับให้ทีม Engineering แก้ไข เหตุผล: "{reason}"'],
  },
  solutionApprovalNeeded: {
    en: ['Solution Approval Needed', 'Solution "{solutionTitle}" needs your approval.'],
    th: ['Solution รอคุณอนุมัติ', 'Solution "{solutionTitle}" รอคุณอนุมัติ'],
  },
  finalApprovalNeeded: {
    en: ['Final Approval Needed', 'Request "{requestTitle}" needs your final approval.'],
    th: ['รอคุณอนุมัติรอบ Final', 'Request "{requestTitle}" รอคุณอนุมัติรอบ Final'],
  },
  requestAutoCompleted: {
    en: ['Request Completed', 'Your request "{requestTitle}" has been completed.'],
    th: ['Request เสร็จแล้ว', 'Request "{requestTitle}" ของคุณเสร็จแล้ว'],
  },
  requestCompleted: {
    en: ['Request Completed', '✅ Request Completed: "{requestTitle}" has been fully approved and completed.'],
    th: ['Request เสร็จแล้ว', '✅ Request "{requestTitle}" อนุมัติครบและเสร็จแล้ว'],
  },
  finalApprovalRejected: {
    en: ['Final Approval Rejected', '❌ Final Rejection: "{requestTitle}" was rejected during final approval. Reason: "{reason}". Please revise the solution.'],
    th: ['ไม่อนุมัติรอบ Final', '❌ ไม่อนุมัติ "{requestTitle}" รอบ Final เหตุผล: "{reason}" โปรดแก้ไข Solution'],
  },
  solutionRevisionReady: {
    en: ['Solution Ready for Review', '📤 Ready for Review: "{requestTitle}" solution has been updated and is ready for your department\'s final review.'],
    th: ['Solution พร้อมให้ตรวจสอบ', '📤 Solution ของ "{requestTitle}" แก้ไขแล้ว พร้อมให้หน่วยงานของคุณตรวจสอบรอบ Final'],
  },
  solutionResubmitted: {
    en: ['Solution Resubmitted', '📤 Solution resubmitted for "{requestTitle}". Please review the updated solution.'],
    th: ['ส่ง Solution อีกครั้ง', '📤 ส่ง Solution ของ "{requestTitle}" อีกครั้ง โปรดตรวจสอบ Solution ที่แก้ไขแล้ว'],
  },
} as const
