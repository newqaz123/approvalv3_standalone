import { HierarchyView } from '@/components/admin/hierarchy-view'
import { getCurrentUserApprovalChain } from '@/server-actions/hierarchy'

export default async function ApprovalChainPage() {
  const approvalChain = await getCurrentUserApprovalChain()

  if (!approvalChain) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Approval Chain</h1>
          <p className="mt-2 text-sm text-gray-600">
            Your account is not assigned to a department.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Approval Chain</h1>
        <p className="mt-2 text-sm text-gray-600">
          Default approval hierarchy for {approvalChain.department.name}.
        </p>
      </div>

      <HierarchyView
        department={approvalChain.department}
        initialUsersByLevel={approvalChain.usersByLevel}
        maxLevel={approvalChain.maxLevel}
        pendingApprovalsCount={0}
        readOnly
      />
    </div>
  )
}
