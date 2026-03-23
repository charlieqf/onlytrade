import React from 'react'

import { SegmentDetailPage } from './pages/SegmentDetailPage'
import { SegmentListPage } from './pages/SegmentListPage'

export function App() {
  const [selectedSegmentId, setSelectedSegmentId] = React.useState<string | null>(null)

  if (selectedSegmentId) {
    return (
      <SegmentDetailPage
        segmentId={selectedSegmentId}
        onBack={() => setSelectedSegmentId(null)}
      />
    )
  }

  return <SegmentListPage onOpenSegment={setSelectedSegmentId} />
}

export default App
