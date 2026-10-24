import { BookOpen } from 'lucide-react'
import { Button, EmptyState, Page, PageHeader, Panel } from '../components/ui'
import { EmeraldMark } from '../components/EmeraldMark'
import { useEmeraldChat } from '../hooks/useEmeraldChat'

// Placeholder until the recipe library is built (plan, Part 2 and "Recipe pages").
export default function Recipes() {
  const { openPanel } = useEmeraldChat()
  return (
    <Page>
      <PageHeader title="Recipes" description="Your family's saved recipes, matched against what's in the pantry." />
      <Panel padded={false}>
        <EmptyState
          icon={BookOpen}
          title="The recipe library is on its way"
          description="Soon you'll be able to save, import and plan recipes here. For now, Emerald can suggest dinner ideas from what you have."
          action={
            <Button variant="secondary" onClick={() => openPanel('What can I make for dinner tonight?')}>
              <EmeraldMark size={16} className="text-emerald" />
              Ask Emerald for ideas
            </Button>
          }
        />
      </Panel>
    </Page>
  )
}
