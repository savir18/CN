# Syllabus mapping and model notes

## Coverage

| Unit | Topic | Where | Status |
|---|---|---|---|
| 1 | Layered architecture | Menu grouped by layer; each lab names its layer | Context only |
| 2 | Circuit and packet switching | Queueing delay and loss in the Queuing and QoS lab | Context only |
| 3 | Hamming code | Error detection lab | Live |
| 3 | CRC, checksum | Error detection lab | Live |
| 3 | Stop-and-Wait | Flow control lab | Live |
| 3 | Go-Back-N, Selective Repeat | Flow control lab | Live |
| 3 | ALOHA, slotted ALOHA, CSMA, CSMA/CD | Multiple access lab | Live |
| 3 | IEEE 802.3 | Through CSMA/CD | Partial |
| 3 | IEEE 802.11 | CSMA/CA not simulated | Theory only |
| 4 | Network layer | none | Not covered |
| 5 | Routing protocols | none | Not covered |
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
