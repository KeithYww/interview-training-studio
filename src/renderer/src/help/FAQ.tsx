import { BookOpen } from 'lucide-react'
import ShortcutRenderer from '@/components/ShortcutRenderer'
import { platformAlt } from '@/lib/utils/env'
import { HelpSection } from './components'

const faqs = [
  {
    question: '如何截取屏幕截图？',
    answer: (
      <span>
        按下
        <ShortcutRenderer shortcut={`${platformAlt}+Enter`} className="text-xs mx-1" />
        快捷键即可截取当前屏幕的截图。截图会自动显示在应用中。
      </span>
    )
  },
  {
    question: '如何处理题目超过一屏的情况？',
    answer: (
      <span>
        按下
        <ShortcutRenderer shortcut={`${platformAlt}+Shift+Enter`} className="text-xs mx-1" />
        快捷键即可在当前对话中追加截图并生成解题建议。
      </span>
    )
  },
  {
    question: '分享屏幕时，对方能看到应用吗？',
    answer: (
      <span>
        当前版本不能保证 offerGet 窗口在所有会议软件和共享模式中隐藏。
        正式面试前请使用当前电脑和实际会议软件完成一次共享测试，并避免共享包含应用窗口的整个桌面。
      </span>
    )
  },
  {
    question: '鼠标移过窗口时，光标会不会变？',
    answer: (
      <span>
        本工具提供了开关，可以开启或关闭鼠标穿透。开启鼠标穿透时，窗口对鼠标隐身，你需要通过快捷键来操作窗口。切换「鼠标穿透」开关的快捷键是{' '}
        <ShortcutRenderer shortcut={`${platformAlt}+M`} className="text-xs" />{' '}
        。窗口右下角会显示当前状态。
      </span>
    )
  },
  {
    question: '语音自动作答是什么？如何使用？',
    answer: (
      <span>
        面试开始后，点击“开启语音自动作答”或按下
        <ShortcutRenderer shortcut={`${platformAlt}+T`} className="text-xs mx-1" />
        即可开始或停止。offerGet
        会捕获电脑中面试官的声音，转写出完整问题，并在短暂停顿后自动调用模型流式给出参考回答。免费用户共
        3 次，每次最多 15 分钟；付费面试在本场剩余时间内不额外扣次。 语音供应商密钥由 offerGet
        服务端保管，客户端不需要填写第三方 API Key。
      </span>
    )
  },
  {
    question: '转录的文本可以单独清除吗？',
    answer: (
      <span>
        可以。按下
        <ShortcutRenderer shortcut={`${platformAlt}+Shift+T`} className="text-xs mx-1" />
        即可清除当前转录文本。截图生成建议后，也会自动清除已经使用的语音文本。
      </span>
    )
  }
]

export function FAQ() {
  return (
    <HelpSection Icon={BookOpen} title="常见问题">
      {faqs.map((faq, index) => (
        <div key={index} className="rounded-xl border border-white/10 bg-white/5 p-4">
          <h3 className="mb-2 font-semibold">{faq.question}</h3>
          <p className="text-sm text-slate-300">{faq.answer}</p>
        </div>
      ))}
    </HelpSection>
  )
}
