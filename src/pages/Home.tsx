import { Brand } from '../components/Brand'
import { Link } from '../router'

export default function Home() {
  return (
    <main className="home">
      <header className="topbar">
        <Brand subtitle="The Sports Committee · TAPMI" />
      </header>

      <section className="home-hero">
        <h1>TPL Auction Dashboard</h1>
        <p>
          A live auction desk for the TAPMI Premier League. Bidding happens in the room; the operator records each final
          sale from one screen, and the projector view updates instantly with the player’s photo, price and team purses.
        </p>
      </section>

      <section className="home-cards">
        <Link to="/operator" className="home-card">
          <span className="home-card-kicker">For the auction desk</span>
          <h2>Operator desk</h2>
          <p>
            Draw the lot order and each player at random, let bidding happen in the room, then enter the winning team and
            final amount. Requires operator sign-in.
          </p>
          <span className="home-card-link">Open /operator →</span>
        </Link>
        <a href="/projection" target="_blank" rel="noreferrer" className="home-card">
          <span className="home-card-kicker">For the projector</span>
          <h2>Projection screen</h2>
          <p>Full-screen, read-only live view of the player on the floor, sold results and team purses.</p>
          <span className="home-card-link">Open /projection in a new tab →</span>
        </a>
        <Link to="/import" className="home-card">
          <span className="home-card-kicker">Before the auction</span>
          <h2>Import players</h2>
          <p>
            Upload the Microsoft Forms registration sheet and the photo zip. Details and photos are matched automatically
            and checked before saving. Requires operator sign-in.
          </p>
          <span className="home-card-link">Open /import →</span>
        </Link>
      </section>

      <section className="card rules">
        <h2>Auction rules (TPL rulebook)</h2>
        <ul>
          <li>Each team starts with 1,200 auction points.</li>
          <li>
            A team may retain one playing owner for 200 points, declared before the auction; the owner counts as one
            squad player.
          </li>
          <li>Squads of 13 to 16 players. Teams cannot buy after reaching 16.</li>
          <li>Every player starts at a base price of 30 points.</li>
          <li>Bids rise in steps of 10 up to 100, then in steps of 20 (120, 140, 160 …).</li>
          <li>Bidding is conducted verbally in the room; the operator records only the winning team and final amount.</li>
          <li>
            A team must always keep 30 points for every player it still needs to reach 13, so the maximum shown for each
            team already accounts for that reserve.
          </li>
          <li>
            Players with no bid go to the Final Unsold Player List. After the regular auction, teams below 13 pick from
            it at 30 points each; if two teams want the same player, bidding restarts from 30.
          </li>
        </ul>
      </section>
    </main>
  )
}
