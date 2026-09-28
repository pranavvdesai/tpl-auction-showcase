export function Brand({ subtitle }: { subtitle: string }) {
  return (
    <div className="brand">
      <img src="/sportscom-logo.jpeg" alt="The Sports Committee, TAPMI" />
      <div>
        <div className="brand-title">TAPMI Premier League Auction</div>
        <div className="brand-subtitle">{subtitle}</div>
      </div>
    </div>
  )
}

export function DummyBadge() {
  return (
    <span className="dummy-badge" title="All players, teams and numbers are fictional prototype data.">
      Dummy data · prototype
    </span>
  )
}
