function StudioLoadingSkeleton() {
  return (
    <div className="flex-1 p-4 overflow-hidden">
      <div className="h-full rounded-xl border border-gray-800 bg-gray-900/40 p-4 animate-pulse flex flex-col gap-4">
        <div className="h-8 w-1/3 rounded bg-gray-800" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 flex-1">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="rounded-lg border border-gray-800 bg-gray-900/50 p-3 space-y-2">
              <div className="aspect-video rounded bg-gray-800" />
              <div className="h-3 rounded bg-gray-800 w-2/3" />
              <div className="h-3 rounded bg-gray-800 w-5/6" />
              <div className="h-3 rounded bg-gray-800 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default StudioLoadingSkeleton
