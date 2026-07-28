import { Link } from 'react-router'
import {
  ArrowLeft,
  Lightbulb,
  MessageCircle,
  Mail,
  Camera,
  Info
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import ShortcutRenderer from '@/components/ShortcutRenderer'
import { platformAlt } from '@/lib/utils/env'
import { HelpSection } from './components'
import { Shortcuts } from './Shortcuts'
import { FAQ } from './FAQ'
import { AccountStatusButton } from '@/account/AccountStatusButton'

export default function HelpPage() {
  return (
    <>
      {/* Header */}
      <div id="app-header" className="flex items-center">
        <div className="actions">
          <Button variant="ghost" asChild size="icon" className="w-12 mr-2 rounded-none">
            <Link to="/">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
        </div>
        <h1>帮助中心</h1>
        <div className="actions ml-auto">
          <AccountStatusButton />
        </div>
      </div>

      {/* Help Content */}
      <div id="app-content" className="flex flex-col gap-4 p-8">
        {/* Introduction */}
        <HelpSection Icon={Info} title="简介">
          <p className="text-gray-700">
            offerGet 是模拟面试练习工具。登录后主动开始一场面试，才会开始计时并启用截图识别。
            模型密钥由服务端安全托管，客户端不会要求你配置 API Key。
          </p>
          <div className="bg-gray-700/10 rounded-lg p-4">
            <h3 className="font-semibold mb-2">主要功能：</h3>
            <ul className="space-y-1 text-gray-700 list-disc list-inside">
              <li className="flex gap-2">
                <Camera className="h-6 w-4" />
                <span>在面试计时期间通过快捷键截图，并生成练习建议。</span>
              </li>
              <li className="flex gap-2">
                <Info className="h-6 w-4" />
                <span>面试中可捕获面试官电脑声音，识别问题并自动生成参考回答。</span>
              </li>
            </ul>
          </div>
        </HelpSection>

        {/* Quick Start */}
        <HelpSection Icon={Lightbulb} title="快速开始">
          <div className="border border-gray-400 rounded-lg p-4">
            <h3 className="font-semibold mb-2">1. 登录并开始面试</h3>
            <p className="text-sm text-gray-700">
              使用 QQ 邮箱登录，在主页面确认免费体验或次卡权益，然后点击“开始面试”。
            </p>
          </div>
          <div className="border border-gray-400 rounded-lg p-4">
            <h3 className="font-semibold mb-2">2. 截取屏幕截图</h3>
            <p className="text-sm text-gray-700">
              面试开始后，按下快捷键{' '}
              <ShortcutRenderer shortcut={`${platformAlt}+Enter`} className="text-xs mx-1" />
              截取当前屏幕。截图会立即显示在应用中。
            </p>
          </div>
          <div className="border border-gray-400 rounded-lg p-4">
            <h3 className="font-semibold mb-2">3. 查看结果</h3>
            <p className="text-sm text-gray-700">
              截图完成后，系统会根据当前选择的提示词场景自动分析内容，给出解题思路和答案。
            </p>
          </div>
        </HelpSection>

        {/* Keyboard Shortcuts */}
        <Shortcuts />

        {/* FAQ */}
        <FAQ />

        {/* Contact Support */}
        <HelpSection Icon={MessageCircle} title="联系支持">
          <p className="text-gray-700">如果您遇到问题或有建议，请通过以下方式联系我们：</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="border border-gray-400 rounded-lg p-4">
              <h3 className="mb-2 flex items-center gap-2 font-semibold">
                <Mail className="size-4 text-orange-500" />
                QQ 邮箱
              </h3>
              <p className="text-gray-700">
                <span className="font-semibold text-gray-900">
                  794637387@qq.com
                </span>
                <span className="ml-2">反馈问题或提出功能建议</span>
              </p>
            </div>
          </div>
        </HelpSection>
      </div>
    </>
  )
}
