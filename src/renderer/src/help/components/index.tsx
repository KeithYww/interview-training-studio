import { LucideIcon } from 'lucide-react'

export function HelpSection({
  Icon,
  title,
  description,
  children
}: {
  Icon: LucideIcon
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="offerget-glass-card p-6">
      <h2 className="mb-4 flex items-center text-lg font-semibold text-white">
        <Icon className="mr-2 h-5 w-5 text-indigo-300" />
        {title}
        {description && (
          <span className="ml-2 pt-1 text-xs font-normal text-slate-500">{description}</span>
        )}
      </h2>
      <div className="space-y-4">{children}</div>
    </div>
  )
}
