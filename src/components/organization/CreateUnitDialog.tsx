'use client'

// Clean-start create-unit dialog (Plan C Task 10, supervisor ruling A): the
// previously inert header "Create unit" action now opens a minimal dialog
// asking for name + parent — no inferred type (the company root exists from
// setup only; the leftover unit-type column is filled by the existing
// createOrganizationUnit action and stays server-side until B15). Calls the
// SAME server action the tree already uses; duplicate sibling names surface
// as the adjacent error with the typed input retained.

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { UnitTreeSelect } from '@/components/organization/UnitTreeSelect'
import type { OrganizationUnitNode } from '@/lib/organization/model'
import { createOrganizationUnit } from '@/server-actions/organization'
import { useTranslations } from '@/lib/i18n/client'

/** Every active unit is a legal parent; sorted by name for a stable list. */
export function createUnitParentOptions(
  units: readonly OrganizationUnitNode[],
): Array<{ id: string; name: string }> {
  return units
    .filter((unit) => unit.isActive)
    .map((unit) => ({ id: unit.id, name: unit.name }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

/** Presentational form body so pending/error states stay SSR-testable. */
export function CreateUnitDialogView({
  units,
  name,
  parentId,
  error,
  saving,
  onNameChange,
  onParentChange,
  onSave,
  onCancel,
}: {
  units: readonly OrganizationUnitNode[]
  name: string
  parentId: string
  error: string | null
  saving: boolean
  onNameChange?: (name: string) => void
  onParentChange?: (parentId: string) => void
  onSave?: () => void
  onCancel?: () => void
}): React.JSX.Element {
  const t = useTranslations()
  const ready = name.trim().length > 0 && parentId.length > 0
  return (
    <div data-testid="create-unit-dialog" className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="create-unit-name-input">{t('admin.unitName')}</Label>
        <Input
          id="create-unit-name-input"
          data-testid="create-unit-name-input"
          value={name}
          onChange={(event) => onNameChange?.(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="create-unit-parent-select">{t('admin.parentUnit')}</Label>
        <UnitTreeSelect
          units={units}
          value={parentId || null}
          onChange={(unitId) => onParentChange?.(unitId)}
          triggerId="create-unit-parent-select"
          triggerTestId="create-unit-parent-select"
          searchTestId="create-unit-parent-search"
          placeholder={t('admin.selectParentUnit')}
        />
      </div>
      {error ? (
        <p role="alert" data-testid="create-unit-error" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          data-testid="create-unit-save"
          disabled={saving || !ready}
          onClick={onSave}
        >
          {t('admin.createUnit')}
        </Button>
        <Button
          type="button"
          variant="outline"
          data-testid="create-unit-cancel"
          disabled={saving}
          onClick={onCancel}
        >
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}

export function CreateUnitDialog({ units }: { units: readonly OrganizationUnitNode[] }): React.JSX.Element {
  const t = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function reset() {
    setName('')
    setParentId('')
    setError(null)
    setSaving(false)
  }

  async function handleSave() {
    setError(null)
    setSaving(true)
    try {
      await createOrganizationUnit({
        name,
        parentId,
      })
      setOpen(false)
      reset()
      router.refresh()
    } catch (err) {
      // Failure keeps the typed name/parent so the user can correct them.
      setError(t('admin.createUnitFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" data-testid="create-unit-open">{t('admin.createUnit')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.createUnit')}</DialogTitle>
          <DialogDescription>
            {t('admin.createUnitHelp')}
          </DialogDescription>
        </DialogHeader>
        <CreateUnitDialogView
          units={units}
          name={name}
          parentId={parentId}
          error={error}
          saving={saving}
          onNameChange={setName}
          onParentChange={setParentId}
          onSave={() => {
            void handleSave()
          }}
          onCancel={() => {
            setOpen(false)
            reset()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
