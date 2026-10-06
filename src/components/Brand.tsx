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
