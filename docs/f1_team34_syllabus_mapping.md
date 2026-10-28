# Syllabus mapping and model notes

## Coverage

| Unit | Topic | Where | Status |
|---|---|---|---|
| 1 | Layered architecture, encapsulation | Packet journey lab; the menu is also grouped by layer | Live |
| 2 | Circuit and packet switching | Packet journey lab (Circuit or packet? mode) | Live |
| 3 | Hamming code | Error detection lab | Live |
| 3 | CRC, checksum | Error detection lab | Live |
| 3 | Stop-and-Wait | Flow control lab | Live |
| 3 | Go-Back-N, Selective Repeat | Flow control lab | Live |
| 3 | ALOHA, slotted ALOHA, CSMA, CSMA/CD | Multiple access lab | Live |
| 3 | IEEE 802.3 | Through CSMA/CD | Partial |
| 3 | IEEE 802.11 | CSMA/CA not simulated | Theory only |
| 4 | IP addressing, subnetting, VLSM, route summarisation | Subnetting lab | Live |
| 4 | IP header, TTL, forwarding | Packet journey lab | Partial |
| 5 | Link state (Dijkstra), distance vector, count to infinity | Routing lab | Live |
| 5 | OSPF, RIP, BGP as protocols | Algorithms only, no protocol messages | Partial |
| 6 | TCP and UDP | Window behaviour only | Partial |
| 6 | Congestion control, traffic management, congestion avoidance | TCP congestion lab | Live |
| 6 | Queuing mechanisms, QoS parameters | Queuing and QoS lab | Live |
| 7 | DNS, HTTP, FTP | none | Not covered |

## Model assumptions (useful for a viva)

**Error detection.** Hamming parity bits sit at power-of-two positions; the syndrome is the position of the wrong bit.
CRC uses modulo-2 division, with standard generators (CRC-3, CRC-4, CRC-5, CRC-8, CRC-16 CCITT) or your own. Checksum is the 16-bit ones' complement sum.
The Monte Carlo test injects random errors and counts how many each scheme misses.

**Flow control.** Event-driven simulation with a fixed one-way propagation delay, frame transmission time 1 and
a = propagation / transmission. Ideal efficiency is 1/(1+2a) for Stop-and-Wait and min(1, W/(1+2a)) for sliding window.
With loss, the simulated numbers are compared with the usual approximations.

**Multiple access.** Time is cut into minislots; a = propagation / frame time = 1/L. Model A uses Poisson offered load G
and reproduces S = G e^(-2G) (ALOHA), S = G e^(-G) (slotted ALOHA) and the Kleinrock-Tobagi CSMA formulas.
Model B runs N stations with binary exponential backoff.

**TCP window lab.** One step is one round-trip time. Slow start doubles cwnd; congestion avoidance adds one.
Triple duplicate ACK: Tahoe cwnd = 1, Reno cwnd = ssthresh (new ssthresh = cwnd / 2). Timeout: cwnd = 1 for both.

**Shared link.** Fluid model in 1 ms steps. Each flow sends cwnd / (RTT + queue / capacity); the queue is the sum of arrivals minus service.
Drop-tail drops on overflow. RED keeps an exponentially weighted average queue and drops with probability rising from 0 to maxp between two thresholds.
A drop makes a flow react one round trip later, then ignore further drops for one round trip.

**Queuing.** Packet-by-packet single output port. VoIP: 200 B every 20 ms. Web: Poisson, 500 B. Bulk: on/off bursts, 1500 B.
WFQ uses the self-clocked approximation (finish tag = max(virtual time, last tag) + size / weight).
A call counts as good if the 95th percentile delay (plus the propagation allowance) is under 150 ms, jitter under 30 ms and loss under 1%.

**Packet journey.** One segment of up to 1460 bytes. Headers are built byte by byte: TCP 20 B (checksum over the pseudo-header), IPv4 20 B (DF set, header checksum), Ethernet 14 B plus a 4 B CRC-32 trailer, so overhead is 58 B.
Each router checks the FCS, lowers the TTL, recomputes the IP checksum and builds a new frame with new MAC addresses. A TTL that reaches 0 is dropped.
Switching delay: circuit = set-up + M/R + propagation; packets = (N + P - 2) full packet times + the last packet + propagation, with P packets over N links (a single packet takes N times its own transmission time).
Sharing uses the binomial tail P(X > m) for n users who are each active with probability p, where m = link rate / user rate.

**Subnetting.** Addresses are unsigned 32-bit integers. Network = address AND mask; broadcast = network OR NOT mask. Usable hosts are 2^(32-p) - 2, except /31 (2, RFC 3021) and /32 (1).
VLSM allocates the largest requirement first, each rounded up to a power of two (plus 2 for network and broadcast), on aligned boundaries. Summarisation finds the longest common prefix and reports any gap.

**Routing.** Link state: Dijkstra with a step trace. Distance vector: synchronous Bellman-Ford rounds, where every router recomputes from its neighbours' previous tables. Infinity is 32 here (RIP uses 16) because the example costs reach 20.
Split horizon hides a route from the neighbour it was learned from; poison reverse advertises it back as infinity.
