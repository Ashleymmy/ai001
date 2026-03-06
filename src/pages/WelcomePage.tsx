/**
 * 功能模块：落地页 - 全屏滚动创意展示页 (丝滑过渡版)
 * 参考: docs/落地页.txt 设计规范
 *
 * 丝滑过渡核心机制:
 * 1. 视差滚动 — 板块内容随滚动偏移产生 translateY + scale + opacity 变化
 * 2. 背景色交叉混合 — 固定背景层根据滚动位置在相邻板块色之间线性插值
 * 3. 内容渐变模糊 — 离开视口的内容逐渐 blur，进入视口的内容逐渐清晰
 * 4. 控制式滚轮捕获 — 桌面端拦截 wheel 事件，一次滚动一个板块，避免跳跃
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Film, ArrowRight, Sparkles, Layout, Zap,
  Lightbulb, Trophy, ChevronDown, Home, Briefcase,
  Eye, FlaskConical, Palette, Image, Layers
} from 'lucide-react'
import { setVisited } from '../App'
import './WelcomePage.css'

// ============================================================================
// 板块背景色定义
// ============================================================================
const SECTION_COLORS = [
  [220, 232, 245],  // #DCE8F5 hero
  [135, 206, 235],  // #87CEEB creativity
  [255, 217, 61],   // #FFD93D tagline
  [108, 92, 231],   // #6C5CE7 method
  [91, 106, 224],   // #5B6AE0 quality
  [255, 255, 255],  // #FFFFFF showcase
  [255, 107, 157],  // #FF6B9D philosophy
  [78, 205, 196],   // #4ECDC4 cta
]

const SECTION_COUNT = SECTION_COLORS.length

/** 在两个 RGB 三元组之间线性插值 */
function lerpColor(a: number[], b: number[], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t)
  const g = Math.round(a[1] + (b[1] - a[1]) * t)
  const bl = Math.round(a[2] + (b[2] - a[2]) * t)
  return `rgb(${r},${g},${bl})`
}

// ============================================================================
// Hook: IntersectionObserver 滚动触发动画 (一次性)
// ============================================================================
const useReveal = (threshold = 0.15) => {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect() } },
      { threshold }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])

  return { ref, visible }
}

// ============================================================================
// Hook: 视差滚动 + 背景色混合 + 板块追踪
// ============================================================================
const useScrollParallax = (
  containerRef: React.RefObject<HTMLDivElement | null>,
  bgRef: React.RefObject<HTMLDivElement | null>,
  innerRefs: React.MutableRefObject<(HTMLDivElement | null)[]>
) => {
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    const bg = bgRef.current
    if (!container || !bg) return

    let rafId: number
    let lastActive = 0

    const update = () => {
      const vh = window.innerHeight
      const scrollTop = container.scrollTop
      const exactIdx = scrollTop / vh
      const floorIdx = Math.floor(exactIdx)
      const frac = exactIdx - floorIdx

      // ---- 1. 背景色插值 ----
      const idxA = Math.min(floorIdx, SECTION_COUNT - 1)
      const idxB = Math.min(floorIdx + 1, SECTION_COUNT - 1)
      bg.style.backgroundColor = lerpColor(SECTION_COLORS[idxA], SECTION_COLORS[idxB], frac)

      // ---- 2. 内容视差 + 透明度 + 模糊 ----
      innerRefs.current.forEach((inner, i) => {
        if (!inner) return
        const sectionTop = i * vh
        // progress: 0 = 完美居中, <0 = 在下方, >0 = 已滚过
        const progress = (scrollTop - sectionTop) / vh

        // 距离视口过远则隐藏
        if (progress < -1.3 || progress > 1.3) {
          inner.style.opacity = '0'
          inner.style.transform = 'translateY(60px) scale(0.92)'
          inner.style.filter = 'blur(6px)'
          return
        }

        const abs = Math.abs(progress)
        // 视差: 内容跟随滚动但偏移量更小 → 产生浮动感
        const translateY = progress * -60
        // 缩放: 离开时略微缩小
        const scale = 1 - abs * 0.06
        // 透明度: 居中时 1，离开时趋向 0
        const opacity = Math.max(0, 1 - abs * 1.6)
        // 模糊: 居中时清晰，离开时模糊
        const blur = abs * 6

        inner.style.transform = `translateY(${translateY}px) scale(${scale})`
        inner.style.opacity = String(Math.min(1, opacity))
        inner.style.filter = blur > 0.3 ? `blur(${blur}px)` : 'none'
      })

      // ---- 3. 活跃板块 ----
      const newActive = Math.round(exactIdx)
      if (newActive !== lastActive) {
        lastActive = newActive
        setActiveIdx(Math.max(0, Math.min(newActive, SECTION_COUNT - 1)))
      }
    }

    const onScroll = () => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(update)
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    // 初始化
    update()

    return () => {
      container.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(rafId)
    }
  }, [containerRef, bgRef, innerRefs])

  return activeIdx
}

// ============================================================================
// Hook: 控制式滚轮 — 桌面端一次滚一个板块
// ============================================================================
const useSmoothWheel = (containerRef: React.RefObject<HTMLDivElement | null>) => {
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let isAnimating = false
    let accDelta = 0
    let wheelTimer: ReturnType<typeof setTimeout>

    const snapTo = (idx: number) => {
      isAnimating = true
      container.scrollTo({
        top: idx * window.innerHeight,
        behavior: 'smooth'
      })
      // 等滚动动画结束后再解锁
      setTimeout(() => { isAnimating = false }, 900)
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (isAnimating) return

      // 累积 delta，避免触控板微小滑动触发跳转
      accDelta += e.deltaY
      clearTimeout(wheelTimer)
      wheelTimer = setTimeout(() => { accDelta = 0 }, 150)

      if (Math.abs(accDelta) < 50) return

      const currentIdx = Math.round(container.scrollTop / window.innerHeight)
      const dir = accDelta > 0 ? 1 : -1
      const next = Math.max(0, Math.min(SECTION_COUNT - 1, currentIdx + dir))

      accDelta = 0
      if (next !== currentIdx) snapTo(next)
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [containerRef])
}

// ============================================================================
// 组件: 页面转场
// ============================================================================
const PageTransition: React.FC<{ isActive: boolean; onComplete: () => void }> = ({ isActive, onComplete }) => {
  const [vis, setVis] = useState(false)

  useEffect(() => {
    if (!isActive) { setVis(false); return }
    const r = requestAnimationFrame(() => setVis(true))
    const t = setTimeout(onComplete, 600)
    return () => { cancelAnimationFrame(r); clearTimeout(t) }
  }, [isActive, onComplete])

  if (!isActive) return null

  return (
    <div className={`wl-transition-overlay ${vis ? 'visible' : ''}`}>
      <div className="wl-transition-box">
        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #6C5CE7, #a29bfe)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Film size={18} color="#fff" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,0.9)' }}>正在进入工作台</span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>请稍候...</span>
        </div>
        <div className="wl-spinner" />
      </div>
    </div>
  )
}

// ============================================================================
// 组件: 底部固定导航
// ============================================================================
const NAV_ITEMS = [
  { label: '首页', icon: Home },
  { label: '创意', icon: Lightbulb },
  { label: '特色', icon: Sparkles },
  { label: '服务', icon: Briefcase },
  { label: '品质', icon: Trophy },
  { label: '作品', icon: Eye },
  { label: '理念', icon: Palette },
  { label: '开始', icon: ArrowRight },
]

interface BottomNavProps {
  active: number
  onNavigate: (idx: number) => void
}

const BottomNav: React.FC<BottomNavProps> = ({ active, onNavigate }) => (
  <nav className="wl-bottom-nav">
    {NAV_ITEMS.map((item, i) => {
      const Icon = item.icon
      return (
        <button
          key={i}
          className={`wl-nav-dot ${active === i ? 'active' : ''}`}
          onClick={() => onNavigate(i)}
        >
          <Icon size={16} />
          <span className="wl-nav-tooltip">{item.label}</span>
        </button>
      )
    })}
  </nav>
)

// ============================================================================
// 组件: 滚动提示
// ============================================================================
const ScrollHint: React.FC = () => (
  <div className="wl-scroll-hint">
    <ChevronDown size={20} />
    <span>向下探索</span>
  </div>
)

// ============================================================================
// 组件: 横向滚动平铺文字
// ============================================================================
interface MarqueeProps {
  text: string
  icon: React.ReactNode
  rows?: number
}

const Marquee: React.FC<MarqueeProps> = ({ text, icon, rows = 3 }) => (
  <div className="wl-marquee">
    {Array.from({ length: rows }).map((_, row) => (
      <div key={row} className={`wl-marquee-row ${row % 2 === 0 ? 'wl-marquee-row--left' : 'wl-marquee-row--right'}`}>
        {Array.from({ length: 8 }).map((_, i) => (
          <span key={i} className="wl-marquee-item">
            {icon}
            {text}
          </span>
        ))}
      </div>
    ))}
  </div>
)

// ============================================================================
// 组件: 彩色作品方块
// ============================================================================
interface ColorBlockProps {
  color: string
  title: string
  subtitle: string
  icon: React.ReactNode
  delay: number
}

const ColorBlock: React.FC<ColorBlockProps> = ({ color, title, subtitle, icon, delay }) => {
  const { ref, visible } = useReveal(0.1)

  return (
    <div
      ref={ref}
      className={`wl-block wl-block--float wl-block-fly ${visible ? 'visible' : ''}`}
      style={{ background: color, transitionDelay: `${delay * 0.1}s` }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: '#fff', textAlign: 'center', padding: 16 }}>
        {icon}
        <span style={{ fontWeight: 700, fontSize: '1rem' }}>{title}</span>
      </div>
      <div className="wl-block-overlay">
        <span style={{ color: '#fff', fontSize: 13, textAlign: 'center', fontWeight: 500 }}>{subtitle}</span>
      </div>
    </div>
  )
}

// ============================================================================
// 主组件
// ============================================================================
export default function WelcomePage() {
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const bgRef = useRef<HTMLDivElement>(null)
  const innerRefs = useRef<(HTMLDivElement | null)[]>([])
  const [isTransitioning, setIsTransitioning] = useState(false)

  // 收集 section-inner 引用
  const setInnerRef = useCallback((idx: number) => (el: HTMLDivElement | null) => {
    innerRefs.current[idx] = el
  }, [])

  // 视差 + 背景混合 + 活跃板块
  const activeSection = useScrollParallax(scrollRef, bgRef, innerRefs)

  // 桌面端控制式滚轮
  useSmoothWheel(scrollRef)

  // Hero 一次性入场动画
  const heroReveal = useReveal(0.1)
  const taglineReveal = useReveal(0.2)
  const methodReveal = useReveal(0.15)
  const philosophyReveal = useReveal(0.2)
  const ctaReveal = useReveal(0.2)

  useEffect(() => {
    document.body.classList.add('welcome-active')
    return () => { document.body.classList.remove('welcome-active') }
  }, [])

  const handleStart = useCallback(() => {
    setVisited()
    setIsTransitioning(true)
  }, [])

  const handleTransitionComplete = useCallback(() => {
    navigate('/home')
  }, [navigate])

  const scrollToSection = useCallback((idx: number) => {
    const container = scrollRef.current
    if (!container) return
    container.scrollTo({ top: idx * window.innerHeight, behavior: 'smooth' })
  }, [])

  return (
    <div className="welcome-page">
      <PageTransition isActive={isTransitioning} onComplete={handleTransitionComplete} />

      {/* 固定背景色层 — 颜色随滚动平滑插值 */}
      <div ref={bgRef} className="wl-bg-blend" style={{ backgroundColor: 'rgb(220,232,245)' }} />

      <div className="wl-scroll-container" ref={scrollRef}>

        {/* ===== 板块1: Hero ===== */}
        <section className="wl-section wl-section--hero">
          <div ref={setInnerRef(0)} className="wl-section-inner">
            <div ref={heroReveal.ref} className={`wl-fade-in ${heroReveal.visible ? 'visible' : ''}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <Film size={28} color="#6C5CE7" />
                <span style={{ fontSize: '1.2rem', fontWeight: 600, color: '#2D3436' }}>AI Storyboarder</span>
              </div>
              <h1 className="wl-hero-title">
                一个专注于{' '}
                <span className="wl-keyword wl-keyword--green">AI 智能</span>
                {' '}与{' '}
                <span className="wl-keyword wl-keyword--pink">分镜创作</span>
                {' '}的
                <br />独立创意工作室
              </h1>
              <p style={{ fontSize: '1.1rem', color: '#636E72', maxWidth: 600, textAlign: 'center', lineHeight: 1.7 }}>
                下一代智能分镜创作系统，利用多模态 AI 技术，根据剧情文本自动生成连续的、风格统一的分镜画面。
              </p>
              <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button className="wl-cta-btn wl-cta-btn--primary" onClick={handleStart}>
                  开始创作 <ArrowRight size={18} />
                </button>
                <button className="wl-cta-btn wl-cta-btn--outline" style={{ color: '#2D3436', borderColor: '#2D3436' }} onClick={() => scrollToSection(1)}>
                  了解更多
                </button>
              </div>
            </div>
          </div>
          <ScrollHint />
        </section>

        {/* ===== 板块2: 创造力 ===== */}
        <section className="wl-section wl-section--creativity">
          <Marquee text="创造力" icon={<Lightbulb />} />
          <div ref={setInnerRef(1)} className="wl-section-inner" style={{ position: 'relative', zIndex: 2 }}>
            <h2 style={{ fontSize: '2.4rem', fontWeight: 800, color: '#2D3436', marginBottom: 16, textAlign: 'center' }}>
              创造力驱动一切
            </h2>
            <p style={{ fontSize: '1.05rem', color: '#2D3436', opacity: 0.7, lineHeight: 1.7, textAlign: 'center', maxWidth: 600 }}>
              AI Storyboarder 涵盖从剧本理解到画面生成的全部创作流程。我们将人工智能的精准分析与艺术创作的灵感表达完美融合。
            </p>
          </div>
          <ScrollHint />
        </section>

        {/* ===== 板块3: 特色标语 ===== */}
        <section className="wl-section wl-section--tagline">
          <div ref={setInnerRef(2)} className="wl-section-inner">
            <div ref={taglineReveal.ref} className={`wl-float-card wl-scale-in ${taglineReveal.visible ? 'visible' : ''}`}>
              <Sparkles size={40} color="#FFD93D" style={{ margin: '0 auto 16px' }} />
              <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#2D3436', marginBottom: 12 }}>
                定制化创作，精确到每一帧！
              </h2>
              <p style={{ fontSize: '1rem', color: '#636E72', lineHeight: 1.7 }}>
                每一个镜头都经过精心设计，确保画面叙事的连贯性与视觉冲击力。从构图到光影，从角色到场景，AI 为你把控每个细节。
              </p>
            </div>
          </div>
          <ScrollHint />
        </section>

        {/* ===== 板块4: 服务与方法 ===== */}
        <section className="wl-section wl-section--method">
          <div ref={setInnerRef(3)} className="wl-section-inner">
            <div ref={methodReveal.ref} className="wl-method-grid">
              <div className={`wl-fade-in-left ${methodReveal.visible ? 'visible' : ''}`}>
                <h2 style={{ fontSize: '2.4rem', fontWeight: 800, color: '#fff', marginBottom: 12 }}>
                  我们的方法
                </h2>
                <p style={{ fontSize: '1.05rem', color: 'rgba(255,255,255,0.75)', lineHeight: 1.8, marginBottom: 24 }}>
                  理解需求，适应风格，智能创作。从剧本分析到成片输出，全链路 AI 驱动的专业工作流。
                </p>
                <button className="wl-cta-btn wl-cta-btn--white" onClick={handleStart}>
                  了解更多 <ArrowRight size={18} />
                </button>
              </div>
              <div className={`wl-service-list wl-fade-in-right ${methodReveal.visible ? 'visible' : ''}`}>
                <div className="wl-service-item">
                  <div className="wl-service-icon"><Sparkles size={20} color="#fff" /></div>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>AI 剧本分析</div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>深度理解上下文，精准提取视觉元素</div>
                  </div>
                </div>
                <div className="wl-service-item">
                  <div className="wl-service-icon"><Layout size={20} color="#fff" /></div>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>智能构图生成</div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>自动推荐最佳机位、景别与构图方案</div>
                  </div>
                </div>
                <div className="wl-service-item">
                  <div className="wl-service-icon"><Zap size={20} color="#fff" /></div>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>实时工作流</div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>所见即所得，支持批量生成与导出</div>
                  </div>
                </div>
                <div className="wl-service-item">
                  <div className="wl-service-icon"><Palette size={20} color="#fff" /></div>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>风格统一</div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>全片分镜风格一致性保障</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <ScrollHint />
        </section>

        {/* ===== 板块5: 品质 ===== */}
        <section className="wl-section wl-section--quality">
          <Marquee text="品质" icon={<Trophy />} />
          <div ref={setInnerRef(4)} className="wl-section-inner" style={{ position: 'relative', zIndex: 2 }}>
            <h2 style={{ fontSize: '2.4rem', fontWeight: 800, color: '#fff', marginBottom: 16, textAlign: 'center' }}>
              追求极致品质
            </h2>
            <p style={{ fontSize: '1.05rem', color: 'rgba(255,255,255,0.75)', lineHeight: 1.7, textAlign: 'center', maxWidth: 600 }}>
              我们追求的不仅是功能，更是那份让作品脱颖而出的独特品质。每一帧画面都经得起专业审视。
            </p>
          </div>
          <ScrollHint />
        </section>

        {/* ===== 板块6: 作品展示 ===== */}
        <section className="wl-section wl-section--showcase">
          <div ref={setInnerRef(5)} className="wl-section-inner">
            <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#2D3436', marginBottom: 40, textAlign: 'center' }}>
              创作展示
            </h2>
            <div className="wl-blocks-grid">
              <ColorBlock color="#4ECDC4" title="科幻场景" subtitle="赛博朋克风格分镜设计" icon={<FlaskConical size={32} />} delay={1} />
              <ColorBlock color="#FFD93D" title="都市情感" subtitle="现代都市光影叙事" icon={<Image size={32} />} delay={2} />
              <ColorBlock color="#4A90D9" title="古风武侠" subtitle="水墨意境东方美学" icon={<Layers size={32} />} delay={3} />
              <ColorBlock color="#87CEEB" title="悬疑探案" subtitle="暗调氛围张力营造" icon={<Eye size={32} />} delay={4} />
              <ColorBlock color="#FF6B9D" title="动画短片" subtitle="风格化角色动画创作" icon={<Film size={32} />} delay={5} />
              <ColorBlock color="#6C5CE7" title="广告创意" subtitle="品牌视觉故事构建" icon={<Sparkles size={32} />} delay={6} />
              <ColorBlock color="#00B894" title="纪录片" subtitle="真实场景分镜重构" icon={<Layout size={32} />} delay={7} />
              <ColorBlock color="#FD79A8" title="MV 分镜" subtitle="音乐节奏视觉化表达" icon={<Palette size={32} />} delay={8} />
            </div>
          </div>
          <ScrollHint />
        </section>

        {/* ===== 板块7: 理念 ===== */}
        <section className="wl-section wl-section--philosophy">
          <div ref={setInnerRef(6)} className="wl-section-inner">
            <div ref={philosophyReveal.ref} className={`wl-philosophy-card wl-scale-in ${philosophyReveal.visible ? 'visible' : ''}`}>
              <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#2D3436', marginBottom: 16 }}>
                理解、适应、创造
              </h2>
              <p style={{ fontSize: '1rem', color: '#636E72', lineHeight: 1.8, marginBottom: 24 }}>
                我们相信优秀的创作工具应该理解创作者的意图，适应不同的创作风格，最终助力每一个创意的完美呈现。AI 不是替代创作者，而是成为创作者最强大的伙伴。
              </p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span className="wl-keyword wl-keyword--blue">理解需求</span>
                <span className="wl-keyword wl-keyword--green">适应风格</span>
                <span className="wl-keyword wl-keyword--purple">智能创作</span>
              </div>
            </div>
          </div>
          <ScrollHint />
        </section>

        {/* ===== 板块8: CTA ===== */}
        <section className="wl-section wl-section--cta">
          <div ref={setInnerRef(7)} className="wl-section-inner">
            <div ref={ctaReveal.ref} className={`wl-fade-in ${ctaReveal.visible ? 'visible' : ''}`} style={{ textAlign: 'center', maxWidth: 600 }}>
              <h2 style={{ fontSize: '2.4rem', fontWeight: 800, color: '#fff', marginBottom: 16 }}>
                准备好开始创作了吗？
              </h2>
              <p style={{ fontSize: '1.05rem', color: 'rgba(255,255,255,0.8)', lineHeight: 1.7, marginBottom: 32 }}>
                立即体验 AI 驱动的分镜创作流程，让你的创意快速转化为专业画面。
              </p>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="wl-cta-btn wl-cta-btn--primary" style={{ background: '#fff', color: '#2D3436' }} onClick={handleStart}>
                  开始创作 <ArrowRight size={18} />
                </button>
                <button className="wl-cta-btn wl-cta-btn--outline" onClick={() => scrollToSection(0)}>
                  回到顶部
                </button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ position: 'absolute', bottom: 24, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 40px', zIndex: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Film size={16} color="rgba(255,255,255,0.6)" />
              <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, fontStyle: 'italic' }}>AI Storyboarder</span>
            </div>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
              &copy; 2024 AI Storyboarder v1.0.0
            </span>
          </div>
        </section>
      </div>

      {/* 底部固定导航 */}
      <BottomNav active={activeSection} onNavigate={scrollToSection} />
    </div>
  )
}
