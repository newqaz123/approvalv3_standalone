'use client'

import { useRouter } from 'next/navigation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Department {
  id: string
  name: string
  type: string
}

interface DepartmentSelectorProps {
  departments: Department[]
  selectedDepartmentId?: string
  basePath: string
}

export function DepartmentSelector({
  departments,
  selectedDepartmentId,
  basePath,
}: DepartmentSelectorProps) {
  const router = useRouter()

  function handleChange(value: string) {
    router.push(`${basePath}?departmentId=${value}`)
  }

  return (
    <div className="flex items-center gap-3">
      <label className="text-sm font-medium text-muted-foreground">Department:</label>
      <Select value={selectedDepartmentId} onValueChange={handleChange}>
        <SelectTrigger className="w-[280px]">
          <SelectValue placeholder="Select a department" />
        </SelectTrigger>
        <SelectContent>
          {departments.map((dept) => (
            <SelectItem key={dept.id} value={dept.id}>
              {dept.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
