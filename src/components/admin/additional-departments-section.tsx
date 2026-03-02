'use client'

import { useState, useEffect, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Trash2 } from 'lucide-react'
import { Department } from '@prisma/client'
import {
  getUserAdditionalDepartments,
  addUserToDepartment,
  removeUserFromDepartment,
} from '@/server-actions/department-assignments'

interface AdditionalDepartmentsSectionProps {
  userId: string
  userRole: 'admin' | 'general_dept' | 'engineering'
  userHomeDepartmentId: string
  departments: Department[]
}

interface DepartmentAssignment {
  id: string
  departmentId: string
  departmentName: string
  departmentType: string
  level: number
}

export function AdditionalDepartmentsSection({
  userId,
  userRole,
  userHomeDepartmentId,
  departments,
}: AdditionalDepartmentsSectionProps) {
  const [assignments, setAssignments] = useState<DepartmentAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDeptId, setSelectedDeptId] = useState<string>('')
  const [selectedLevel, setSelectedLevel] = useState<string>('1')
  const [isPending, startTransition] = useTransition()

  // Fetch current assignments on mount
  useEffect(() => {
    async function fetchAssignments() {
      try {
        const data = await getUserAdditionalDepartments(userId)
        setAssignments(data)
      } catch (err) {
        console.error('Failed to fetch additional departments:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchAssignments()
  }, [userId])

  // Filter available departments based on role rules
  const assignedDeptIds = assignments.map((a) => a.departmentId)
  const availableDepartments = departments.filter((dept) => {
    // Exclude home department
    if (dept.id === userHomeDepartmentId) return false
    // Exclude already assigned departments
    if (assignedDeptIds.includes(dept.id)) return false
    // Role-based filtering (admin sees all)
    if (userRole === 'admin') return true
    if (userRole === 'engineering' && dept.type === 'GENERAL') return false
    if (userRole === 'general_dept' && dept.type === 'ENGINEERING') return false
    return true
  })

  const handleAdd = () => {
    if (!selectedDeptId || !selectedLevel) return
    setError(null)

    startTransition(async () => {
      try {
        await addUserToDepartment(userId, selectedDeptId, parseInt(selectedLevel, 10))
        // Refresh the list
        const data = await getUserAdditionalDepartments(userId)
        setAssignments(data)
        setSelectedDeptId('')
        setSelectedLevel('1')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add department')
      }
    })
  }

  const handleRemove = (departmentId: string) => {
    setError(null)

    startTransition(async () => {
      try {
        await removeUserFromDepartment(userId, departmentId)
        // Refresh the list
        const data = await getUserAdditionalDepartments(userId)
        setAssignments(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove department')
      }
    })
  }

  return (
    <div className="border-t pt-4 mt-4">
      <h4 className="text-sm font-semibold mb-3">Additional Department Assignments</h4>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-3 text-sm">
          {error}
        </div>
      )}

      {/* Current assignments list */}
      {loading ? (
        <div className="space-y-2">
          <div className="h-8 bg-muted animate-pulse rounded" />
          <div className="h-8 bg-muted animate-pulse rounded" />
        </div>
      ) : assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground mb-3">No additional department assignments</p>
      ) : (
        <div className="space-y-2 mb-3">
          {assignments.map((assignment) => (
            <div
              key={assignment.id}
              className="flex items-center justify-between gap-2 px-3 py-2 border rounded-md text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{assignment.departmentName}</span>
                <Badge variant="secondary" className="text-xs">
                  Level {assignment.level}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                onClick={() => handleRemove(assignment.departmentId)}
                disabled={isPending}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add department form */}
      {availableDepartments.length > 0 && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block">Department</label>
            <Select value={selectedDeptId} onValueChange={setSelectedDeptId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {availableDepartments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-20">
            <label className="text-xs text-muted-foreground mb-1 block">Level</label>
            <Input
              type="number"
              min={1}
              max={10}
              value={selectedLevel}
              onChange={(e) => setSelectedLevel(e.target.value)}
              className="h-9"
            />
          </div>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={isPending || !selectedDeptId}
            className="h-9"
          >
            {isPending ? 'Adding...' : 'Add'}
          </Button>
        </div>
      )}

      {!loading && availableDepartments.length === 0 && assignments.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          All eligible departments have been assigned.
        </p>
      )}
    </div>
  )
}
