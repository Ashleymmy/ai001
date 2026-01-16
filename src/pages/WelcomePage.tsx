import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Film, ArrowRight, Sparkles, Layout, Zap,
  Play, Users, Image, FileText, ChevronDown,
  MousePointer2
} from 'lucide-react'
import { setVisited } from '../App'

// ============================================================================
// 工具函数
// ============================================================================
const lerp = (start: number, end: number, factor: number) => start + (end - start) * factor

// ============================================================================
// Hook: 视差滚动
// ============================================================================
const useParallax = (speed: number = 0.5) => {
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const handleScroll = () => {
      setOffset(window.scrollY * speed)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [speed])

  return offset
}

// ============================================================================
// Hook: 滚动触发动画
// ============================================================================
const useScrollReveal = (threshold: number = 0.1) => {
  const ref = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { threshold }
    )

    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [threshold])

  return { ref, isVisible }
}

// ============================================================================
// Hook: 平滑鼠标追踪
// ============================================================================
const useSmoothMouse = () => {
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [smoothMouse, setSmoothMouse] = useState({ x: 0, y: 0 })
  const frameRef = useRef<number>()

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      setMouse({
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: (e.clientY / window.innerHeight) * 2 - 1
      })
    }
    window.addEventListener('mousemove', handleMove)
    return () => window.removeEventListener('mousemove', handleMove)
  }, [])

  useEffect(() => {
    const animate = () => {
      setSmoothMouse(prev => ({
        x: lerp(prev.x, mouse.x, 0.08),
        y: lerp(prev.y, mouse.y, 0.08)
      }))
      frameRef.current = requestAnimationFrame(animate)
    }
    frameRef.current = requestAnimationFrame(animate)
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [mouse])

  return smoothMouse
}

// ============================================================================
// 组件: 磁性按钮
// ============================================================================
interface MagneticButtonProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}

const MagneticButton: React.FC<MagneticButtonProps> = ({ children, className = '', onClick }) => {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const distanceX = (e.clientX - centerX) * 0.3
    const distanceY = (e.clientY - centerY) * 0.3
    setPosition({ x: distanceX, y: distanceY })
  }

  const handleMouseLeave = () => {
    setPosition({ x: 0, y: 0 })
  }

  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`transition-transform duration-200 ease-out ${className}`}
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      {children}
    </button>
  )
}

// ============================================================================
// 组件: 3D 倾斜卡片
// ============================================================================
interface TiltCardProps {
  children: React.ReactNode
  className?: string
  glareEnabled?: boolean
}

const TiltCard: React.FC<TiltCardProps> = ({ children, className = '', glareEnabled = true }) => {
  const cardRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState('')
  const [glarePos, setGlarePos] = useState({ x: 50, y: 50 })
  const [isHovered, setIsHovered] = useState(false)

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    const rotateX = (y - 0.5) * -20
    const rotateY = (x - 0.5) * 20

    setTransform(`perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`)
    setGlarePos({ x: x * 100, y: y * 100 })
  }

  const handleMouseLeave = () => {
    setTransform('perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)')
    setIsHovered(false)
  }

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      className={`relative transition-transform duration-300 ease-out ${className}`}
      style={{ transform, transformStyle: 'preserve-3d' }}
    >
      {children}
      {glareEnabled && (
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none transition-opacity duration-300"
          style={{
            opacity: isHovered ? 1 : 0,
            background: `radial-gradient(circle at ${glarePos.x}% ${glarePos.y}%, rgba(255,255,255,0.15) 0%, transparent 60%)`
          }}
        />
      )}
    </div>
  )
}

// ============================================================================
// 组件: 聚光灯卡片
// ============================================================================
interface SpotlightCardProps {
  children: React.ReactNode
  className?: string
  color?: string
}

const SpotlightCard: React.FC<SpotlightCardProps> = ({
  children,
  className = '',
  color = 'rgba(120, 119, 198, 0.15)'
}) => {
  const divRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [opacity, setOpacity] = useState(0)

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!divRef.current) return
    const rect = divRef.current.getBoundingClientRect()
    setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    setOpacity(1)
  }

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setOpacity(0)}
      className={`relative overflow-hidden ${className}`}
    >
      <div
        className="pointer-events-none absolute -inset-px transition-opacity duration-500"
        style={{
          opacity,
          background: `radial-gradient(800px circle at ${position.x}px ${position.y}px, ${color}, transparent 40%)`
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  )
}

// ============================================================================
// 组件: 动态计数器
// ============================================================================
interface AnimatedCounterProps {
  end: number
  duration?: number
  suffix?: string
  prefix?: string
}

const AnimatedCounter: React.FC<AnimatedCounterProps> = ({
  end,
  duration = 2000,
  suffix = '',
  prefix = ''
}) => {
  const [count, setCount] = useState(0)
  const { ref, isVisible } = useScrollReveal()

  useEffect(() => {
    if (!isVisible) return

    let startTime: number
    let animationFrame: number

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp
      const progress = Math.min((timestamp - startTime) / duration, 1)
      const easeOut = 1 - Math.pow(1 - progress, 3)
      setCount(Math.floor(easeOut * end))

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate)
      }
    }

    animationFrame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationFrame)
  }, [isVisible, end, duration])

  return (
    <span ref={ref} className="tabular-nums">
      {prefix}{count.toLocaleString()}{suffix}
    </span>
  )
}

// ============================================================================
// 组件: 打字机效果
// ============================================================================
interface TypewriterProps {
  texts: string[]
  speed?: number
  delay?: number
}

const Typewriter: React.FC<TypewriterProps> = ({ texts, speed = 80, delay = 2000 }) => {
  const [displayText, setDisplayText] = useState('')
  const [textIndex, setTextIndex] = useState(0)
  const [charIndex, setCharIndex] = useState(0)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    const currentText = texts[textIndex]

    const timeout = setTimeout(() => {
      if (!isDeleting) {
        if (charIndex < currentText.length) {
          setDisplayText(currentText.slice(0, charIndex + 1))
          setCharIndex(charIndex + 1)
        } else {
          setTimeout(() => setIsDeleting(true), delay)
        }
      } else {
        if (charIndex > 0) {
          setDisplayText(currentText.slice(0, charIndex - 1))
          setCharIndex(charIndex - 1)
        } else {
          setIsDeleting(false)
          setTextIndex((textIndex + 1) % texts.length)
        }
      }
    }, isDeleting ? speed / 2 : speed)

    return () => clearTimeout(timeout)
  }, [charIndex, isDeleting, textIndex, texts, speed, delay])

  return (
    <span className="inline-flex items-center">
      {displayText}
      <span className="ml-1 w-[3px] h-[1.1em] bg-purple-400 animate-pulse" />
    </span>
  )
}

// ============================================================================
// 组件: 流动线条背景
// ============================================================================
const FlowingLines: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number
    let lines: { x: number; y: number; vx: number; vy: number; life: number }[] = []

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', handleMouseMove)

    const createLine = () => {
      if (lines.length < 50) {
        lines.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          life: 1
        })
      }
    }

    const animate = () => {
      ctx.fillStyle = 'rgba(10, 10, 10, 0.05)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      createLine()

      lines = lines.filter(line => {
        line.x += line.vx
        line.y += line.vy
        line.life -= 0.003

        // 轻微受鼠标影响
        const dx = mouseRef.current.x - line.x
        const dy = mouseRef.current.y - line.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 200) {
          line.vx += dx * 0.00005
          line.vy += dy * 0.00005
        }

        if (line.life > 0) {
          ctx.beginPath()
          ctx.arc(line.x, line.y, 1, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(139, 92, 246, ${line.life * 0.3})`
          ctx.fill()

          // 连线
          lines.forEach(other => {
            const d = Math.sqrt((line.x - other.x) ** 2 + (line.y - other.y) ** 2)
            if (d < 100 && d > 0) {
              ctx.beginPath()
              ctx.moveTo(line.x, line.y)
              ctx.lineTo(other.x, other.y)
              ctx.strokeStyle = `rgba(139, 92, 246, ${(1 - d / 100) * line.life * 0.1})`
              ctx.stroke()
            }
          })
          return true
        }
        return false
      })

      animationId = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', handleMouseMove)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none opacity-60"
    />
  )
}

// ============================================================================
// 组件: 文字遮罩
// ============================================================================
interface TextMaskProps {
  children: React.ReactNode
  className?: string
}

const TextMask: React.FC<TextMaskProps> = ({ children, className = '' }) => {
  const mouse = useSmoothMouse()

  return (
    <div className={`relative ${className}`}>
      {/* 背景层 - 渐变 */}
      <div
        className="absolute inset-0 bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 opacity-80"
        style={{
          transform: `translate(${mouse.x * 20}px, ${mouse.y * 20}px)`
        }}
      />
      {/* 文字遮罩层 */}
      <div
        className="relative bg-clip-text text-transparent"
        style={{
          backgroundImage: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
          backgroundSize: '200% 200%',
          animation: 'gradient-shift 5s ease infinite'
        }}
      >
        {children}
      </div>
    </div>
  )
}

// ============================================================================
// 组件: 统计卡片
// ============================================================================
interface StatCardProps {
  icon: React.ReactNode
  value: number
  label: string
  suffix?: string
  color: string
  delay?: number
}

const StatCard: React.FC<StatCardProps> = ({ icon, value, label, suffix = '', color, delay = 0 }) => {
  const { ref, isVisible } = useScrollReveal()

  return (
    <div
      ref={ref}
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 transition-all duration-700 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <div className={`absolute top-0 right-0 w-32 h-32 ${color} rounded-full blur-3xl opacity-20 -translate-y-1/2 translate-x-1/2`} />
      <div className="relative">
        <div className={`w-12 h-12 rounded-xl ${color.replace('bg-', 'bg-')}/20 flex items-center justify-center mb-4`}>
          {icon}
        </div>
        <div className="text-4xl font-bold text-white mb-1">
          <AnimatedCounter end={value} suffix={suffix} />
        </div>
        <div className="text-sm text-gray-400">{label}</div>
      </div>
    </div>
  )
}

// ============================================================================
// 组件: 功能展示卡片
// ============================================================================
interface FeatureCardProps {
  icon: React.ReactNode
  title: string
  description: string
  tags: string[]
  color: string
  delay?: number
}

const FeatureCard: React.FC<FeatureCardProps> = ({
  icon, title, description, tags, color, delay = 0
}) => {
  const { ref, isVisible } = useScrollReveal()

  return (
    <TiltCard
      className={`h-full transition-all duration-700 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
      }`}
    >
      <SpotlightCard
        className="h-full rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] backdrop-blur-xl"
        color={color}
      >
        <div ref={ref} className="p-8 h-full flex flex-col" style={{ transitionDelay: `${delay}ms` }}>
          <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${color.replace('rgba', 'from-').split(',')[0]}/20 to-transparent flex items-center justify-center mb-6 ring-1 ring-white/10`}>
            {icon}
          </div>
          <h3 className="text-xl font-semibold text-white mb-3">{title}</h3>
          <p className="text-gray-400 text-sm leading-relaxed flex-grow mb-6">{description}</p>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag, i) => (
              <span
                key={i}
                className="text-[10px] uppercase tracking-wider bg-white/5 text-gray-300 px-3 py-1.5 rounded-full border border-white/10"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </SpotlightCard>
    </TiltCard>
  )
}

// ============================================================================
// 组件: 页面转场动画
// ============================================================================
interface PageTransitionProps {
  isActive: boolean
  onComplete: () => void
}

const PageTransition: React.FC<PageTransitionProps> = ({ isActive, onComplete }) => {
  const [phase, setPhase] = useState(0) // 0: hidden, 1: layer1, 2: layer2, 3: layer3

  useEffect(() => {
    if (!isActive) return

    // 立即开始第一层动画
    const t0 = setTimeout(() => setPhase(1), 50)
    // 第二层
    const t1 = setTimeout(() => setPhase(2), 400)
    // 第三层
    const t2 = setTimeout(() => setPhase(3), 700)
    // 完成跳转
    const t3 = setTimeout(() => {
      onComplete()
    }, 1000)

    return () => {
      clearTimeout(t0)
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [isActive, onComplete])

  if (!isActive) return null

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden">
      {/* 第一层 - 紫粉渐变 */}
      <div
        className="absolute rounded-full bg-gradient-to-br from-purple-600 to-pink-600"
        style={{
          width: '200vmax',
          height: '200vmax',
          left: '50%',
          top: '50%',
          transform: `translate(-50%, -50%) scale(${phase >= 1 ? 1 : 0})`,
          transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      />

      {/* 第二层 - 靛蓝紫渐变 */}
      <div
        className="absolute rounded-full bg-gradient-to-br from-indigo-600 to-purple-600"
        style={{
          width: '200vmax',
          height: '200vmax',
          left: '50%',
          top: '50%',
          transform: `translate(-50%, -50%) scale(${phase >= 2 ? 1 : 0})`,
          transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      />

      {/* 第三层 - 深色背景 */}
      <div
        className="absolute rounded-full bg-[#0a0a12]"
        style={{
          width: '200vmax',
          height: '200vmax',
          left: '50%',
          top: '50%',
          transform: `translate(-50%, -50%) scale(${phase >= 3 ? 1 : 0})`,
          transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      />

      {/* 中心 Logo */}
      <div
        className="absolute left-1/2 top-1/2 z-10"
        style={{
          transform: `translate(-50%, -50%) scale(${phase >= 1 && phase < 3 ? 1 : phase >= 3 ? 1.5 : 0.5})`,
          opacity: phase >= 1 && phase < 3 ? 1 : 0,
          transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-2xl shadow-purple-500/50">
          <Film size={40} className="text-white" />
        </div>
      </div>

      {/* 加载文字 */}
      <div
        className="absolute left-1/2 top-1/2 z-10"
        style={{
          transform: 'translate(-50%, 60px)',
          opacity: phase >= 1 && phase < 3 ? 1 : 0,
          transition: 'opacity 0.3s ease'
        }}
      >
        <span className="text-white/90 text-sm font-medium tracking-widest">LOADING</span>
      </div>
    </div>
  )
}

// ============================================================================
// 主组件
// ============================================================================
export default function WelcomePage() {
  const navigate = useNavigate()
  const mouse = useSmoothMouse()
  const parallaxOffset = useParallax(0.3)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)

  useEffect(() => {
    setTimeout(() => setIsLoaded(true), 100)
  }, [])

  const handleStart = () => {
    setVisited() // 标记已访问
    setIsTransitioning(true)
  }

  const handleTransitionComplete = useCallback(() => {
    navigate('/home')
  }, [navigate])

  const scrollToFeatures = () => {
    document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className={`relative min-h-screen w-full bg-[#050505] text-white overflow-x-hidden selection:bg-purple-500/30 ${
      isTransitioning ? 'overflow-hidden' : ''
    }`}>

      {/* 转场动画 */}
      <PageTransition isActive={isTransitioning} onComplete={handleTransitionComplete} />

      {/* ========== 背景层 ========== */}
      <FlowingLines />

      {/* 网格背景 */}
      <div
        className="fixed inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255, 255, 255, 0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.5) 1px, transparent 1px)
          `,
          backgroundSize: '100px 100px',
          transform: `translate(${mouse.x * -15}px, ${mouse.y * -15}px)`
        }}
      />

      {/* 动态光斑 */}
      <div
        className="fixed top-[-20%] left-[-10%] w-[600px] h-[600px] bg-purple-600/30 rounded-full blur-[150px] pointer-events-none"
        style={{ transform: `translate(${mouse.x * 40}px, ${mouse.y * 40}px)` }}
      />
      <div
        className="fixed bottom-[-20%] right-[-10%] w-[700px] h-[700px] bg-blue-600/20 rounded-full blur-[150px] pointer-events-none"
        style={{ transform: `translate(${mouse.x * -50}px, ${mouse.y * -50}px)` }}
      />
      <div
        className="fixed top-1/2 left-1/2 w-[500px] h-[500px] bg-pink-600/10 rounded-full blur-[120px] pointer-events-none -translate-x-1/2 -translate-y-1/2"
        style={{ transform: `translate(calc(-50% + ${mouse.x * 30}px), calc(-50% + ${mouse.y * 30}px))` }}
      />

      {/* ========== Hero Section ========== */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6">
        {/* 顶部导航占位 */}
        <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Film size={20} className="text-white" />
            </div>
            <span className="font-semibold text-white/90">AI Storyboarder</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              v1.0.0-beta
            </span>
          </div>
        </div>

        {/* 主内容 */}
        <div
          className={`text-center max-w-5xl mx-auto transition-all duration-1000 ${
            isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
          style={{ transform: `translateY(${parallaxOffset * -0.2}px)` }}
        >
          {/* Logo */}
          <TiltCard className="inline-block mb-10">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500 to-pink-500 rounded-3xl blur-2xl opacity-50 animate-pulse" />
              <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center ring-1 ring-white/20 shadow-2xl">
                <Film size={48} className="text-white drop-shadow-lg" />
              </div>
            </div>
          </TiltCard>

          {/* 标题 */}
          <h1 className="text-6xl md:text-8xl font-bold tracking-tight mb-6">
            <span className="inline-block bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-gray-500">
              AI Storyboarder
            </span>
          </h1>

          {/* 副标题 - 打字机效果 */}
          <div className="text-xl md:text-2xl text-gray-400 mb-4 h-8">
            <Typewriter
              texts={['智能分镜生成', '风格一致性保持', 'AI 驱动创作', '从剧本到画面']}
              speed={100}
              delay={2500}
            />
          </div>

          <p className="text-gray-500 text-lg max-w-2xl mx-auto mb-12 leading-relaxed">
            下一代智能分镜创作系统，利用多模态 AI 技术，
            <br className="hidden md:block" />
            根据剧情文本自动生成连续的、风格统一的分镜画面。
          </p>

          {/* 按钮组 */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <MagneticButton
              onClick={handleStart}
              className="group relative flex items-center gap-3 px-10 py-5 bg-white text-black rounded-full font-semibold text-lg overflow-hidden"
            >
              <span className="relative z-10 flex items-center gap-3">
                开始创作
                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-purple-400 to-pink-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="absolute inset-0 rounded-full ring-2 ring-white/20 group-hover:ring-purple-400/50 transition-all" />
            </MagneticButton>

            <MagneticButton
              onClick={scrollToFeatures}
              className="group flex items-center gap-3 px-10 py-5 rounded-full font-semibold text-gray-300 hover:text-white border border-white/10 hover:border-white/20 backdrop-blur-sm transition-all"
            >
              探索功能
              <ChevronDown size={18} className="group-hover:translate-y-1 transition-transform" />
            </MagneticButton>
          </div>

          {/* 统计数据 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
            <StatCard
              icon={<Users className="text-blue-400" size={24} />}
              value={1280}
              label="活跃用户"
              suffix="+"
              color="bg-blue-500"
              delay={0}
            />
            <StatCard
              icon={<Image className="text-purple-400" size={24} />}
              value={52800}
              label="生成分镜"
              suffix="+"
              color="bg-purple-500"
              delay={100}
            />
            <StatCard
              icon={<FileText className="text-pink-400" size={24} />}
              value={3600}
              label="剧本分析"
              suffix="+"
              color="bg-pink-500"
              delay={200}
            />
            <StatCard
              icon={<Play className="text-orange-400" size={24} />}
              value={980}
              label="视频导出"
              suffix="+"
              color="bg-orange-500"
              delay={300}
            />
          </div>
        </div>

        {/* 滚动提示 */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-gray-500 animate-bounce">
          <MousePointer2 size={16} />
          <span className="text-xs">向下滚动</span>
        </div>
      </section>

      {/* ========== Features Section ========== */}
      <section id="features" className="relative py-32 px-6">
        <div className="max-w-7xl mx-auto">
          {/* Section Header */}
          <div className="text-center mb-20">
            <TextMask className="inline-block">
              <h2 className="text-4xl md:text-6xl font-bold">
                核心功能
              </h2>
            </TextMask>
            <p className="text-gray-500 mt-6 max-w-2xl mx-auto">
              融合最前沿的 AI 技术，打造专业级分镜创作工具
            </p>
          </div>

          {/* Feature Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <FeatureCard
              icon={<Sparkles className="text-blue-400" size={28} />}
              title="AI 剧本分析"
              description="深度理解剧本上下文，自动拆解场景、角色与动作，精准提取视觉元素，生成专业级分镜描述。"
              tags={['NLP', 'GPT-4', '语义理解']}
              color="rgba(59, 130, 246, 0.15)"
              delay={0}
            />
            <FeatureCard
              icon={<Layout className="text-purple-400" size={28} />}
              title="智能构图生成"
              description="基于电影视听语言规则，自动推荐最佳机位、景别与构图方案，确保整体风格统一协调。"
              tags={['SDXL', 'ControlNet', '风格迁移']}
              color="rgba(139, 92, 246, 0.15)"
              delay={100}
            />
            <FeatureCard
              icon={<Zap className="text-pink-400" size={28} />}
              title="实时工作流"
              description="所见即所得的创作体验，支持局部重绘、角色固定、批量导出，大幅提升创作效率。"
              tags={['实时预览', '批量处理']}
              color="rgba(236, 72, 153, 0.15)"
              delay={200}
            />
          </div>
        </div>
      </section>

      {/* ========== CTA Section ========== */}
      <section className="relative py-32 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <TiltCard className="inline-block">
            <div className="relative rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.02] backdrop-blur-xl p-12 md:p-16 overflow-hidden">
              {/* 背景装饰 */}
              <div className="absolute top-0 left-0 w-full h-full">
                <div className="absolute top-[-50%] left-[-20%] w-[400px] h-[400px] bg-purple-500/20 rounded-full blur-[100px]" />
                <div className="absolute bottom-[-50%] right-[-20%] w-[400px] h-[400px] bg-blue-500/20 rounded-full blur-[100px]" />
              </div>

              <div className="relative z-10">
                <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">
                  准备好开始创作了吗？
                </h2>
                <p className="text-gray-400 mb-10 max-w-xl mx-auto">
                  立即体验 AI 驱动的分镜创作流程，让你的创意快速转化为专业画面。
                </p>
                <MagneticButton
                  onClick={handleStart}
                  className="group inline-flex items-center gap-3 px-12 py-5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-full font-semibold text-lg shadow-2xl shadow-purple-500/25 hover:shadow-purple-500/40 transition-all"
                >
                  立即开始
                  <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                </MagneticButton>
              </div>
            </div>
          </TiltCard>
        </div>
      </section>

      {/* ========== Footer ========== */}
      <footer className="relative py-8 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-gray-500">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Film size={16} className="text-white" />
            </div>
            <span>AI Storyboarder</span>
          </div>
          <div>
            &copy; 2024 AI Storyboarder. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}
