# Detroit Cyber Ready

**Know when your city is at risk, before an incident becomes an outage.**

Built for the Venture 313 AI Buildathon, September 2025.

---

## Impact pillar

**Open, Accessible & Responsible Government.**

A city is responsible for keeping the digital services residents depend on available and trustworthy. Detroit Cyber Ready watches for external changes that put those services at risk, investigates them automatically, and tells the city's security team which service is affected and what to do next.

911 Emergency Communications is the anchor. It is the sharpest example of that responsibility, and it is the service a municipal security team worries about first.

---

## The problem

A sitting municipal CISO described it this way:

> "I have Tenable and other tools. I don't care about vulnerabilities. I want to be alerted if something is proactive."

A city of Detroit's size already owns vulnerability scanners, often more than one. What it does not own is the layer above them: something that watches the outside world, notices when a change out there makes an existing exposure suddenly urgent, investigates it without a human, and says which city service is at risk.

> Tenable tells Detroit what is vulnerable. Detroit Cyber Ready tells Detroit when something changes that could matter right now, investigates it automatically, determines which city service could be affected, and tells the team what to do next.

---

## How it works

```
DETECT                INVESTIGATE                 ACT
Something             Does it matter to           What should we fix
changed.              Detroit, and to which       right now, and who
                      city service?               owns it?
```

1. **Detect.** Live external threat intelligence: CISA Known Exploited Vulnerabilities, NVD, EPSS, CISA advisories. Plus attack surface change detection.
2. **Match, deterministically.** A newly exploited vendor and product is matched against the city's technology inventory. No model decides whether Detroit is exposed. The match is an auditable database row.
3. **Propagate, one hop.** Most signals do not land on a city service directly. They land on shared infrastructure the service depends on. A remote access appliance is one hop from 911.
4. **Investigate.** An agent pipeline assembles context, validates techniques, and correlates service impact.
5. **Act.** A prioritized action plan with owners and SLAs, and a CISO-ready alert.

**The design principle: the match is deterministic, only the narrative is generated.** The model explains, prioritizes and writes. It never decides whether the city is exposed.

---

## What is real and what is simulated

We are explicit about this because a security product that overstates its inputs is not a security product.

| Layer | Source | Status |
|---|---|---|
| Actively exploited vulnerabilities | CISA KEV | **Real, live** |
| Vulnerability context, CVSS, CPE | NVD | **Real, live** |
| Exploitation probability | FIRST.org EPSS | **Real, live** |
| Advisories | CISA | **Real, live** |
| Which vendor and product each service runs | authored by us | **Simulated, labeled in the UI** |
| Dependencies between services and infrastructure | authored by us | **Simulated, labeled in the UI** |
| External attack surface observations | synthetic source | **Simulated, labeled in the UI** |
| Service map coordinates, department names | authored by us, approximate | **Simulated** — pulling the real values from data.detroitmi.gov is a documented next step, not yet built |

**We do not scan cities.** No system in this repository performs reconnaissance against City of Detroit infrastructure or any other real target. Every hostname in the seed data uses an RFC 2606 reserved domain and every address is inside an RFC 5737 documentation range, and there is a test that enforces it.

In production, the inventory is not simulated. A city supplies it, or we ingest it from the Tenable, CMDB and endpoint tooling it already pays for. **Tenable is an input, not a competitor.**

---

## Language we do not use

External threat intelligence cannot prove a city is under attack. This product says "new external threat signal," "potential exposure," "evidence of targeting," and "requires investigation." It does not say "you are being hacked."

---

## Upstream dependencies

Every line of Detroit-specific code in this repository was written during the buildathon weekend. The following are consumed as pinned upstream dependencies and are not our work:

| Upstream | How it is consumed | What it provides |
|---|---|---|
| [mukul975/Anthropic-Cybersecurity-Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills) | git submodule, pinned | The cybersecurity skills corpus used for investigation step selection |
| Casky platform | HTTPS API, `csk_` key | Investigation playbooks and CVE analysis |
| [casky-ai/casky-runner](https://github.com/casky-ai/casky-runner) | referenced | Execution tier, not wired for this build |

See `docs/connectors.md` for the full connector contract table and what each one requires to go live.

---

## Status

Under active development during the buildathon. See `plans/001_prd.md` for the full product requirements document, architecture, and execution plan.

## License

Apache-2.0
