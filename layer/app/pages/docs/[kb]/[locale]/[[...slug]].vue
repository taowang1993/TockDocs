<script setup lang="ts">
import type { DocsCollectionItem } from '../../../../types'

definePageMeta({
  layout: 'docs',
})

const { t } = useTockDocsI18n()
const docs = useTockDocs()
const { isOpen: assistantOpen, isHydrated: assistantHydrated } = useAssistant()

if (!docs.isDocsRoute.value || !docs.activeKnowledgeBase.value || !docs.activeLocale.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found' })
}

const {
  page,
  surround,
  title,
  description,
  headline,
  breadcrumbs,
  github,
  editLink,
  sourcePath,
  assistantDocked,
} = await useDocsPage(docs.collectionName)

useSeo({
  title,
  description,
  type: 'article',
  modifiedAt: computed(() => (page.value as unknown as Record<string, unknown>)?.modifiedAt as string | undefined),
  breadcrumbs,
})

defineOgImage('Docs', {
  headline: headline.value,
  title: title.value?.slice(0, 60),
  description: formatOgDescription(title.value, description.value),
})

const displayPage = computed(() => withoutDuplicateTitleHeading(page.value))
</script>

<template>
  <UPage
    v-if="page"
    :class="assistantDocked ? 'lg:gap-5' : ''"
  >
    <UPageHeader
      :title="page.title"
      :description="page.description"
      :headline="headline"
      :ui="{
        wrapper: 'flex-row items-center flex-wrap justify-between',
      }"
      data-markdown-ignore
    >
      <template #links>
        <div class="flex items-center gap-2 flex-wrap">
          <UButton
            v-for="(link, index) in (page as DocsCollectionItem).links"
            :key="index"
            size="sm"
            v-bind="link"
          />

          <DocsPageHeaderLinks :source-path="sourcePath" />
        </div>
      </template>
    </UPageHeader>

    <UPageBody>
      <ContentRenderer
        v-if="displayPage"
        :value="displayPage"
      />

      <div
        v-if="github"
        data-markdown-ignore
      >
        <USeparator>
          <div class="flex items-center gap-2 text-sm text-muted">
            <UButton
              variant="link"
              color="neutral"
              :to="editLink"
              target="_blank"
              icon="i-lucide-pen"
              :ui="{ leadingIcon: 'size-4' }"
            >
              {{ t('docs.edit') }}
            </UButton>
            <template v-if="github?.url">
              <span>{{ t('common.or') }}</span>
              <UButton
                variant="link"
                color="neutral"
                :to="`${github.url}/issues/new/choose`"
                target="_blank"
                icon="i-lucide-alert-circle"
                :ui="{ leadingIcon: 'size-4' }"
              >
                {{ t('docs.report') }}
              </UButton>
            </template>
          </div>
        </USeparator>
      </div>

      <div data-markdown-ignore>
        <UContentSurround :surround="surround" />
      </div>
    </UPageBody>

    <template
      v-if="displayPage?.body?.toc?.links?.length && !(assistantHydrated && assistantOpen)"
      #right
    >
      <DocsAsideRight
        :page="displayPage"
      />
    </template>
  </UPage>
</template>
