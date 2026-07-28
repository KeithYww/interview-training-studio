import { useState } from 'react'
import { Link } from 'react-router'
import { Plus, RotateCcw, Settings2, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { PRESET_SCENE_PROMPTS, useSettingsStore } from '@/lib/store/settings'

export function SceneQuickSwitch() {
  const { scenes, activeSceneId, setActiveScene } = useSettingsStore()

  return (
    <section className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white/80 px-4 py-3 text-slate-700 shadow-sm backdrop-blur">
      <div className="mr-1 flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="size-4 text-orange-500" />
        作答场景
      </div>
      {scenes.map((scene) => (
        <button
          key={scene.id}
          type="button"
          data-testid={`scene-${scene.id}`}
          aria-pressed={scene.id === activeSceneId}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            scene.id === activeSceneId
              ? 'border-orange-500 bg-orange-500 text-white shadow-sm'
              : 'border-slate-300 bg-white text-slate-600 hover:border-orange-300 hover:text-orange-600'
          )}
          onClick={() => setActiveScene(scene.id)}
        >
          {scene.name}
        </button>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-7 rounded-full px-2.5 text-xs text-slate-500 hover:text-orange-600"
        asChild
      >
        <Link to="/settings">
          <Settings2 className="size-3.5" />
          管理 / 新增
        </Link>
      </Button>
    </section>
  )
}

export function SceneManagerCard() {
  const {
    scenes,
    activeSceneId,
    setActiveScene,
    updateScenePrompt,
    addScene,
    removeScene
  } = useSettingsStore()
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const activeScene = scenes.find((scene) => scene.id === activeSceneId)
  const deletingScene = scenes.find((scene) => scene.id === deleteId)

  const createScene = () => {
    const name = newName.trim()
    const prompt = newPrompt.trim()
    if (!name || !prompt) return
    const id = addScene(name)
    updateScenePrompt(id, prompt)
    setNewName('')
    setNewPrompt('')
    setAddOpen(false)
  }

  return (
    <>
      <section className="rounded-lg bg-gray-300/80 p-6">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center text-lg font-semibold">
              <Sparkles className="mr-2 size-5" />
              作答场景
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              截图识题与语音自动作答都会使用当前场景的提示词。
            </p>
          </div>
          <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            新增场景
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {scenes.map((scene) => (
            <div
              key={scene.id}
              className={cn(
                'flex items-center overflow-hidden rounded-full border text-sm transition-colors',
                scene.id === activeSceneId
                  ? 'border-orange-500 bg-orange-500 text-white'
                  : 'border-gray-300 bg-white text-gray-700'
              )}
            >
              <button
                type="button"
                className="px-3 py-1.5"
                onClick={() => setActiveScene(scene.id)}
              >
                {scene.name}
              </button>
              {!scene.isPreset && (
                <button
                  type="button"
                  aria-label={`删除场景 ${scene.name}`}
                  className="mr-1 rounded-full p-1 opacity-70 hover:bg-black/10 hover:opacity-100"
                  onClick={() => setDeleteId(scene.id)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>

        {activeScene && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-medium">
                「{activeScene.name}」系统提示词
              </label>
              {activeScene.isPreset && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() =>
                    updateScenePrompt(
                      activeScene.id,
                      PRESET_SCENE_PROMPTS[activeScene.id] ?? ''
                    )
                  }
                >
                  <RotateCcw className="size-3.5" />
                  恢复默认
                </Button>
              )}
            </div>
            <Textarea
              value={activeScene.prompt}
              maxLength={20_000}
              rows={7}
              className="min-h-36 bg-white"
              placeholder="描述这个场景下模型应如何理解问题和组织答案"
              onChange={(event) => updateScenePrompt(activeScene.id, event.target.value)}
            />
            <p className="mt-1 text-xs text-gray-500">修改会自动保存在本机，并立即同步给模型。</p>
          </div>
        )}
      </section>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新增自定义场景</DialogTitle>
            <DialogDescription>
              例如：系统设计面试、数学考试、产品经理面试或行业知识问答。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={newName}
              maxLength={20}
              autoFocus
              placeholder="场景名称"
              onChange={(event) => setNewName(event.target.value)}
            />
            <Textarea
              value={newPrompt}
              maxLength={20_000}
              rows={6}
              className="min-h-32"
              placeholder="输入这个场景专属的系统提示词"
              onChange={(event) => setNewPrompt(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!newName.trim() || !newPrompt.trim()}
              onClick={createScene}
            >
              创建并启用
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteId)} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除自定义场景</DialogTitle>
            <DialogDescription>
              确定删除「{deletingScene?.name}」吗？其提示词将无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteId(null)}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (deleteId) removeScene(deleteId)
                setDeleteId(null)
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
