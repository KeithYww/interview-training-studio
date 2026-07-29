import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'

// Ref https://github.com/tailwindlabs/tailwindcss-typography to fine-tune the markdown style
export default function MarkdownRenderer({ children }: { children: string }) {
  return (
    <div className="rounded-2xl border border-indigo-300/15 bg-slate-950/88 px-5 py-4 shadow-xl shadow-black/30 backdrop-blur-xl">
      <div className="prose prose-sm prose-invert max-w-none prose-headings:text-white prose-p:text-slate-100 prose-li:text-slate-100 prose-strong:text-white prose-a:text-indigo-300 prose-hr:border-white/10 prose-pre:border prose-pre:border-white/10 prose-pre:bg-[#0a0a0f] prose-pre:p-0 prose-code:text-xs">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {children}
        </ReactMarkdown>
      </div>
    </div>
  )
}
