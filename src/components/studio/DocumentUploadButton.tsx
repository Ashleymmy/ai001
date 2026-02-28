import { useState, useRef, type ChangeEvent } from 'react'
import { FileUp, Loader2 } from 'lucide-react'
import { parseDocument } from '../../services/api'

interface DocumentUploadButtonProps {
  /** 提取到文本后的回调 */
  onTextExtracted: (text: string, fileName: string) => void
  /** 接受的文件类型，默认 '.txt,.md,.docx,.pdf' */
  accept?: string
  /** 按钮文字，默认 '上传文档' */
  label?: string
  /** 是否禁用 */
  disabled?: boolean
  /** 自定义 className */
  className?: string
}

const CLIENT_PARSE_EXTS = new Set(['.txt', '.md', '.markdown'])

export default function DocumentUploadButton({
  onTextExtracted,
  accept = '.txt,.md,.docx,.pdf',
  label = '上传文档',
  disabled = false,
  className,
}: DocumentUploadButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // 重置 input 以便同一文件可再次选择
    e.target.value = ''

    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
    setLoading(true)
    setError(null)

    try {
      let text: string
      if (CLIENT_PARSE_EXTS.has(ext)) {
        // 纯文本文件直接客户端读取
        text = await file.text()
      } else {
        // docx/pdf 走后端解析
        const result = await parseDocument(file)
        text = result.text
      }
      if (!text || !text.trim()) {
        setError('文档内容为空')
        return
      }
      onTextExtracted(text, file.name)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '文档解析失败'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className || ''}`}>
      <label
        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer transition-colors
          ${disabled || loading
            ? 'bg-gray-800/50 text-gray-500 cursor-not-allowed'
            : 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-700'
          }`}
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileUp className="w-3 h-3" />}
        <span>{loading ? '解析中...' : label}</span>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleFile}
          disabled={disabled || loading}
          className="hidden"
        />
      </label>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  )
}
