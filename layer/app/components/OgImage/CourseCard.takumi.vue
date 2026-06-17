<script lang="ts" setup>
const { title, description, variant } = defineProps<{
  title?: string
  description?: string
  variant?: string
}>()

const variants: Record<string, { icon: string, gradient: string }> = {
  chemistry: { icon: '🧪', gradient: 'from-emerald-500/30 via-green-500/20 to-teal-500/30' },
  investing: { icon: '📈', gradient: 'from-amber-500/30 via-orange-500/20 to-red-500/30' },
  manual: { icon: '📘', gradient: 'from-blue-500/30 via-indigo-500/20 to-violet-500/30' },
}
const v = variants[variant || 'chemistry'] || variants.chemistry!
</script>

<template>
  <div class="w-full h-full flex flex-col bg-neutral-950">
    <!-- Top gradient strip -->
    <div :class="`h-2/5 w-full bg-gradient-to-br ${v.gradient} flex items-center justify-center`">
      <span class="text-[120px] leading-none">{{ v.icon }}</span>
    </div>
    <!-- Bottom content area -->
    <div class="flex-1 flex flex-col justify-center px-16 py-12">
      <h2 class="m-0 text-[48px] font-bold text-white leading-tight">
        {{ title || 'Course' }}
      </h2>
      <p class="m-0 mt-4 text-[28px] text-neutral-400 leading-snug line-clamp-2">
        {{ description || '' }}
      </p>
    </div>
  </div>
</template>
