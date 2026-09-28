import { Brand, DummyBadge } from '../components/Brand'
import { Link } from '../router'

export default function Home() {
  return (
    <main className="home">
      <header className="topbar">
        <Brand subtitle="The Sports Committee · TAPMI" />
        <DummyBadge />
      </header>

      <section className="home-hero">
        <h1>TPL Auction Dashboard</h1>
        <p>
          A live auction desk for the TAPMI Premier League. The operator records every bid from one screen, and the
          projector view updates instantly for the room.
        </p>
      </section>

      <section className="home-cards">
        <Link to="/operator" className="home-card">
          <span className="home-card-kicker">For the auction desk</span>
          <h2>Operator desk</h2>
          <p>
            Put a player on the projector, let bidding happen in the room, then enter the winning team and final amount.
            Requires operator sign-in.
          </p>
          <span className="home-card-link">Open /operator →</span>
        </Link>
        <a href="/projection" target="_blank" rel="noreferrer" className="home-card">
          <span className="home-card-kicker">For the projector</span>
          <h2>Projection screen</h2>
          <p>Full-screen, read-only live view of the player on the floor, sold results and team purses.</p>
          <span className="home-card-link">Open /projection in a new tab →</span>
        </a>
      </section>

      <section className="card rules">
        <h2>Prototype auction rules</h2>
        <ul>
          <li>8 franchises, each with a purse of 10,000 points.</li>
          <li>Squad size of 8 to 10 players bought at auction.</li>
          <li>Base prices: Marquee 500, Set A 300, Set B 200, Set C 100 points.</li>
          <li>Bidding is conducted verbally in the room; the operator records only the winning team and final amount.</li>
          <li>The final amount must be at least the player’s base price.</li>
          <li>
            A team must always keep enough purse to fill its minimum squad at 100 points per remaining player, so the
            maximum shown for each team already accounts for that reserve.
          </li>
          <li>Players nobody bids for can be marked unsold and brought back later.</li>
        </ul>
      </section>
    </main>
  )
}
