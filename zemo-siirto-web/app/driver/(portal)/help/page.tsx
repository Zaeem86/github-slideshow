import type { Metadata } from "next";

export const metadata: Metadata = { title: "Help" };

export default function Help() {
  return <div className="grid">
    <div className="card">
      <h2>Ohjeet</h2>
      <p className="sub">Turvallisuus ja protokolla.</p>
      <ul className="guidelines">
        <li>Tee noutotarkastus ennen ajoon lähtöä.</li>
        <li>Noudata nopeusrajoituksia ja taloudellista ajotapaa.</li>
        <li>Tupakointi ja lemmikit autossa on ehdottomasti kielletty.</li>
        <li>Säilytä polttoaine- tai latauskuitit kulukorvausta varten.</li>
        <li>Ota luovutuskuvat heti pysäköinnin jälkeen.</li>
      </ul>
    </div>
    <div className="card">
      <h2>Asiakaspalvelu</h2>
      <p className="sub">Ongelmia siirron aikana? Ota yhteyttä.</p>
      <a className="btn" href="mailto:tuki@zemosiirto.fi">tuki@zemosiirto.fi</a>
    </div>
  </div>;
}
