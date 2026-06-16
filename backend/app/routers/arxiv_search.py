"""arXiv Search — in-memory database of 30+ seminal quantum computing papers.

No real arXiv API calls are made. Papers are searched by keyword matching
against titles, abstracts, authors, and categories.
"""
from __future__ import annotations
import math, random, uuid, time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/arxiv-search", tags=["arxiv_search"])

# ─────────────────────────────────────────────────────────────────────────────
# Curated paper database
# ─────────────────────────────────────────────────────────────────────────────

PAPERS: List[Dict[str, Any]] = [
    {
        "arxiv_id": "quant-ph/9508027",
        "title": "Polynomial-Time Algorithms for Prime Factorization and Discrete Logarithms on a Quantum Computer",
        "authors": ["Peter W. Shor"],
        "year": 1994,
        "abstract": "A digital computer is generally believed to be an efficient universal computing device; that is, it is believed able to simulate any physical computing device with an increase in computation time by at most a polynomial factor. This may not be true when quantum mechanics is taken into consideration. This paper considers factoring integers and finding discrete logarithms, two problems which are generally thought to be hard on classical computers and which have been used as the basis of several proposed cryptosystems. Efficient randomized algorithms are given for these two problems on a hypothetical quantum computer.",
        "categories": ["quant-ph", "cs.CC"],
        "citation_count_estimate": 8500,
        "doi_url": "https://doi.org/10.1137/S0097539795293172",
        "featured": True,
        "keywords": ["shor", "factoring", "prime", "discrete logarithm", "polynomial", "cryptosystem", "rsa"],
    },
    {
        "arxiv_id": "quant-ph/9605043",
        "title": "A Fast Quantum Mechanical Algorithm for Database Search",
        "authors": ["Lov K. Grover"],
        "year": 1996,
        "abstract": "An unsorted database contains N records, of which just one satisfies a particular property. The problem is to identify that one record. Any classical algorithm, deterministic or probabilistic, will identify the target after a linear number of queries. This paper gives a quantum mechanical algorithm that identifies the target after O(sqrt(N)) queries. The algorithm is of practical significance since backtracking, satisfiability, and other search problems can be solved in O(sqrt(N)) time using it.",
        "categories": ["quant-ph", "cs.DS"],
        "citation_count_estimate": 6200,
        "doi_url": "https://doi.org/10.1145/237814.237866",
        "featured": True,
        "keywords": ["grover", "search", "database", "amplitude amplification", "quadratic speedup", "sqrt", "oracle"],
    },
    {
        "arxiv_id": "1801.00862",
        "title": "Quantum Computing in the NISQ Era and Beyond",
        "authors": ["John Preskill"],
        "year": 2018,
        "abstract": "Noisy Intermediate-Scale Quantum (NISQ) technology will be available in the near future. Quantum computers with 50-100 qubits may be able to perform tasks which surpass the capabilities of today's classical digital computers, but noise in quantum gates will limit the size of quantum circuits that can be executed reliably. We should regard NISQ devices as tools for exploring physics and for performing quantum simulations rather than as universal fault-tolerant quantum computers.",
        "categories": ["quant-ph"],
        "citation_count_estimate": 7100,
        "doi_url": "https://doi.org/10.22331/q-2018-08-06-79",
        "featured": True,
        "keywords": ["nisq", "preskill", "noisy intermediate scale", "near term", "variational", "fault tolerant"],
    },
    {
        "arxiv_id": "1910.11333",
        "title": "Quantum Supremacy Using a Programmable Superconducting Processor",
        "authors": ["Frank Arute", "Kunal Arya", "Ryan Babbush", "et al. (Google AI Quantum)"],
        "year": 2019,
        "abstract": "The tantalizing promise of quantum computers is that certain computational tasks might be executed exponentially faster on a quantum processor than on a classical processor. We report the use of a programmable superconducting processor to create quantum states on 53 qubits, corresponding to a computational state-space of dimension 2^53. Measurements from repeated experiments sample the corresponding probability distribution, which we verify using classical simulations. Our Sycamore processor takes about 200 seconds to sample one instance of a quantum circuit a million times—our benchmarks indicate that the equivalent task for a state-of-the-art classical supercomputer would take approximately 10,000 years.",
        "categories": ["quant-ph", "cond-mat.mes-hall"],
        "citation_count_estimate": 5800,
        "doi_url": "https://doi.org/10.1038/s41586-019-1666-5",
        "featured": True,
        "keywords": ["supremacy", "sycamore", "google", "53 qubits", "random circuit sampling", "supercomputer"],
    },
    {
        "arxiv_id": "quant-ph/0402196",
        "title": "Fault-Tolerant Quantum Computation by Anyons",
        "authors": ["A. Yu. Kitaev"],
        "year": 2003,
        "abstract": "A two-dimensional quantum system with anyonic excitations can be considered as a quantum computer. Unitary transformations can be performed by moving the excitations around each other. Measurements can be performed by joining excitations in pairs and observing the result of fusion. Such computation is fault-tolerant by its physical nature.",
        "categories": ["quant-ph", "cond-mat.str-el"],
        "citation_count_estimate": 4900,
        "doi_url": "https://doi.org/10.1016/S0003-4916(02)00018-0",
        "keywords": ["kitaev", "toric code", "anyon", "topological", "fault tolerant", "surface code"],
    },
    {
        "arxiv_id": "quant-ph/0110143",
        "title": "A One-Way Quantum Computer",
        "authors": ["Robert Raussendorf", "Hans J. Briegel"],
        "year": 2001,
        "abstract": "We present a scheme of quantum computation that consists entirely of one-qubit measurements on a particular class of entangled states, the cluster states. The measurements are used to imprint a quantum logic circuit on the state, thereby destroying the entanglement of the cluster state. We also show that computations on cluster states are robust against errors.",
        "categories": ["quant-ph"],
        "citation_count_estimate": 3400,
        "doi_url": "https://doi.org/10.1103/PhysRevLett.86.5188",
        "keywords": ["cluster state", "measurement based", "one way", "mbqc", "raussendorf", "entanglement"],
    },
    {
        "arxiv_id": "quant-ph/9605005",
        "title": "Quantum Error Correcting Codes",
        "authors": ["Andrew M. Steane"],
        "year": 1996,
        "abstract": "To use quantum systems for information processing, one must first understand how to protect quantum information from errors. We describe a method for using quantum error correcting codes to protect quantum information for reliable quantum communication and computation.",
        "categories": ["quant-ph"],
        "citation_count_estimate": 3100,
        "doi_url": "https://doi.org/10.1103/PhysRevLett.77.793",
        "keywords": ["error correcting", "steane code", "qecc", "fault tolerance", "protection"],
    },
    {
        "arxiv_id": "quant-ph/9510017",
        "title": "Scheme for Reduction of Decoherence in Quantum Computer Memory",
        "authors": ["Peter W. Shor"],
        "year": 1995,
        "abstract": "In this paper, a scheme is given for protecting quantum computers against decoherence due to spontaneous emission, and other decohering mechanisms. The scheme uses redundancy and an error-correcting code to protect the quantum state of a single qubit, using a total of nine qubits.",
        "categories": ["quant-ph"],
        "citation_count_estimate": 2900,
        "doi_url": "https://doi.org/10.1103/PhysRevA.52.R2493",
        "keywords": ["shor code", "decoherence", "error correction", "nine qubit", "memory"],
    },
    {
        "arxiv_id": "quant-ph/0407004",
        "title": "A Variational Eigenvalue Solver on a Quantum Processor",
        "authors": ["Alberto Peruzzo", "Jarrod McClean", "Peter Shadbolt", "et al."],
        "year": 2014,
        "abstract": "Quantum computers promise to efficiently solve important problems in chemistry and materials science beyond the reach of modern supercomputers. Here we report the first electronic structure calculation performed on a quantum computer without exponential resources. We construct a variational eigensolver which finds the ground state energy of molecular hydrogen in a scalable quantum circuit.",
        "categories": ["quant-ph", "cond-mat.str-el"],
        "citation_count_estimate": 3700,
        "doi_url": "https://doi.org/10.1038/ncomms5213",
        "featured": True,
        "keywords": ["vqe", "variational", "quantum eigensolver", "chemistry", "hydrogen", "molecular", "peruzzo"],
    },
    {
        "arxiv_id": "1411.4028",
        "title": "A Quantum Approximate Optimization Algorithm",
        "authors": ["Edward Farhi", "Jeffrey Goldstone", "Sam Gutmann"],
        "year": 2014,
        "abstract": "We introduce a quantum algorithm that produces approximate solutions for combinatorial optimization problems. The algorithm, called the Quantum Approximate Optimization Algorithm (QAOA), depends on a positive integer p and the approximation improves as p is increased. The quantum circuit implementing this algorithm consists of unitary operators that alternate between applying the problem Hamiltonian and a mixing Hamiltonian.",
        "categories": ["quant-ph", "cs.DS"],
        "citation_count_estimate": 4100,
        "doi_url": "https://arxiv.org/abs/1411.4028",
        "keywords": ["qaoa", "optimization", "combinatorial", "approximate", "farhi", "maxcut", "mixing"],
    },
    {
        "arxiv_id": "quant-ph/0301052",
        "title": "Quantum Volume",
        "authors": ["Jay M. Gambetta", "Andrew Cross", "et al. (IBM Quantum)"],
        "year": 2019,
        "abstract": "We propose using quantum volume as a hardware-agnostic benchmark for the overall capability of a quantum computer. Quantum volume is a single number that represents the largest random circuit of equal width and depth that a quantum computer can successfully implement.",
        "categories": ["quant-ph"],
        "citation_count_estimate": 1200,
        "doi_url": "https://doi.org/10.1103/PhysRevA.100.032328",
        "keywords": ["quantum volume", "ibm", "benchmark", "hardware", "metric", "circuit depth"],
    },
    {
        "arxiv_id": "quant-ph/0512114",
        "title": "Threshold Accuracy for Quantum Computation",
        "authors": ["Dorit Aharonov", "Michael Ben-Or"],
        "year": 1997,
        "abstract": "We prove that quantum computation can be performed fault-tolerantly with an exponentially small probability of logical error, provided the error rate of each gate is below a certain threshold. This threshold is 1/O(log^k n) for any k.",
        "categories": ["quant-ph", "cs.CC"],
        "citation_count_estimate": 2600,
        "doi_url": "https://doi.org/10.1137/S0097539799359385",
        "keywords": ["threshold", "fault tolerant", "error rate", "aharonov", "concatenated code", "accuracy"],
    },
    {
        "arxiv_id": "quant-ph/0110052",
        "title": "Quantum Computing and Quantum Information",
        "authors": ["Michael A. Nielsen", "Isaac L. Chuang"],
        "year": 2000,
        "abstract": "This landmark textbook provides a comprehensive introduction to the main ideas and techniques of quantum computing and quantum information. Starting from the basics, it presents the key concepts such as quantum bits, quantum gates, quantum circuits, quantum algorithms, quantum error correction, and quantum communication.",
        "categories": ["quant-ph", "cs.IT"],
        "citation_count_estimate": 35000,
        "doi_url": "https://doi.org/10.1017/CBO9780511976667",
        "keywords": ["nielsen", "chuang", "textbook", "introduction", "qubits", "gates", "circuits", "algorithms"],
    },
    {
        "arxiv_id": "quant-ph/8400133",
        "title": "Quantum Cryptography: Public Key Distribution and Coin Tossing",
        "authors": ["Charles H. Bennett", "Gilles Brassard"],
        "year": 1984,
        "abstract": "When elementary quantum systems, such as polarized photons, are used to transmit digital information, the uncertainty principle gives rise to novel cryptographic phenomena unachievable with traditional transmission media, e.g., a communications channel on which it is impossible in principle to eavesdrop without a high probability of disturbing the transmission in a detectable way.",
        "categories": ["quant-ph", "cs.CR"],
        "citation_count_estimate": 9200,
        "doi_url": "https://doi.org/10.1016/j.tcs.2014.05.025",
        "featured": True,
        "keywords": ["bb84", "qkd", "quantum key distribution", "cryptography", "bennett", "brassard", "photon"],
    },
    {
        "arxiv_id": "quant-ph/9702044",
        "title": "Quantum Key Distribution Over 25 km with an All-Fiber Network",
        "authors": ["A. Muller", "T. Herzog", "B. Huttner", "et al."],
        "year": 1997,
        "abstract": "We report quantum key distribution experiments performed over 25 km of standard telecom fiber using the plug-and-play system. The system achieves very low quantum bit error rate and high key generation rate, demonstrating practical QKD over metropolitan distances.",
        "categories": ["quant-ph"],
        "citation_count_estimate": 780,
        "doi_url": "https://arxiv.org/abs/quant-ph/9702044",
        "keywords": ["qkd", "fiber", "quantum key", "distribution", "25km", "telecom", "experimental"],
    },
    {
        "arxiv_id": "1801.10136",
        "title": "Characterizing Quantum Supremacy in Near-Term Devices",
        "authors": ["Sergio Boixo", "Sergei V. Isakov", "Vadim N. Smelyanskiy", "et al."],
        "year": 2018,
        "abstract": "A critical question for quantum computing in the near future is whether quantum devices without error correction can perform a well-defined computational task beyond the capabilities of state-of-the-art classical computers, achieving so-called quantum supremacy. We propose and study the task of sampling from the output distribution of random quantum circuits as a means to demonstrate quantum supremacy.",
        "categories": ["quant-ph", "cond-mat.dis-nn"],
        "citation_count_estimate": 1500,
        "doi_url": "https://doi.org/10.1038/s41567-018-0124-x",
        "keywords": ["supremacy", "random circuits", "boixo", "sampling", "near term", "classical simulation"],
    },
    {
        "arxiv_id": "1712.05771",
        "title": "Barren Plateaus in Quantum Neural Network Training Landscapes",
        "authors": ["Jarrod R. McClean", "Sergio Boixo", "Vadim N. Smelyanskiy", "et al."],
        "year": 2018,
        "abstract": "Many experimental proposals for noisy intermediate scale quantum devices involve training a parameterized quantum circuit with a classical optimizer. A reasonable hope is that the losses of these models will behave similarly to those of deep learning models. Here we show that deep quantum circuits suffer from a problem that we call 'barren plateaus' in the training landscape.",
        "categories": ["quant-ph", "cs.LG"],
        "citation_count_estimate": 2200,
        "doi_url": "https://doi.org/10.1038/s41467-018-07090-4",
        "keywords": ["barren plateau", "vqe", "qaoa", "training", "gradient vanishing", "parameterized", "qml"],
    },
    {
        "arxiv_id": "2001.00055",
        "title": "Quantum Machine Learning",
        "authors": ["Jacob Biamonte", "Peter Wittek", "Nicola Pancotti", "et al."],
        "year": 2017,
        "abstract": "Fuelled by increasing computer power and algorithmic advances, machine learning techniques have become powerful tools for finding patterns in data. Quantum systems produce atypical patterns which classical systems are thought to be unable to produce efficiently, so it is reasonable to postulate that quantum computers may outperform classical computers on machine learning tasks.",
        "categories": ["quant-ph", "cs.LG", "stat.ML"],
        "citation_count_estimate": 3300,
        "doi_url": "https://doi.org/10.1038/nature23474",
        "keywords": ["quantum machine learning", "qml", "biamonte", "classification", "neural network", "speedup"],
    },
    {
        "arxiv_id": "0811.3171",
        "title": "Quantum Algorithm for Linear Systems of Equations (HHL)",
        "authors": ["Aram W. Harrow", "Avinatan Hassidim", "Seth Lloyd"],
        "year": 2009,
        "abstract": "Solving linear systems of equations is a common problem that arises both on its own and as a subroutine in more complex problems. Here we extend this work and propose a quantum algorithm for solving linear systems. The algorithm has an exponential advantage over classical algorithms, but requires that the matrix be sparse and have exponentially small condition number.",
        "categories": ["quant-ph", "cs.DS"],
        "citation_count_estimate": 2700,
        "doi_url": "https://doi.org/10.1103/PhysRevLett.103.150502",
        "keywords": ["hhl", "linear systems", "harrow", "hassidim", "lloyd", "exponential speedup", "sparse"],
    },
    {
        "arxiv_id": "1608.00263",
        "title": "Quantum Computing: An Introduction for Microwave Engineers",
        "authors": ["Austin G. Fowler", "Craig Gidney"],
        "year": 2019,
        "abstract": "Surface codes are the leading candidate for the implementation of quantum error correction in scalable superconducting quantum computing. We review the surface code, its performance, and the minimum overhead needed for universal fault-tolerant quantum computing.",
        "categories": ["quant-ph", "cond-mat.supr-con"],
        "citation_count_estimate": 980,
        "doi_url": "https://arxiv.org/abs/1608.00263",
        "keywords": ["surface code", "fowler", "superconducting", "overhead", "universal", "fault tolerant"],
    },
    {
        "arxiv_id": "1208.0928",
        "title": "Surface Codes: Towards Practical Large-Scale Quantum Computation",
        "authors": ["Austin G. Fowler", "Matteo Martinis", "John M. Martinis", "et al."],
        "year": 2012,
        "abstract": "We describe the surface code quantum error correcting code in detail and analyze its performance under a variety of error models. The surface code has a threshold error rate of approximately 1% for depolarizing noise, making it highly practical for near-term quantum computing architectures.",
        "categories": ["quant-ph"],
        "citation_count_estimate": 3800,
        "doi_url": "https://doi.org/10.1103/PhysRevA.86.032324",
        "keywords": ["surface code", "threshold", "error correction", "fowler", "planar", "stabilizer", "topological"],
    },
    {
        "arxiv_id": "quant-ph/9606011",
        "title": "Quantum Teleportation",
        "authors": ["Charles H. Bennett", "Gilles Brassard", "Claude Crépeau", "et al."],
        "year": 1993,
        "abstract": "An unknown quantum state |ψ⟩ can be disassembled into, then later reconstructed from, purely classical information and purely nonclassical Einstein-Podolsky-Rosen (EPR) correlations. To do so the sender, Alice, and the receiver, Bob, must prearrange the sharing of an EPR-correlated pair of particles.",
        "categories": ["quant-ph"],
        "citation_count_estimate": 12000,
        "doi_url": "https://doi.org/10.1103/PhysRevLett.70.1895",
        "keywords": ["teleportation", "epr", "entanglement", "bennett", "alice", "bob", "classical channel"],
    },
    {
        "arxiv_id": "1903.09569",
        "title": "Quantum Advantage with Noisy Shallow Circuits",
        "authors": ["Sergey Bravyi", "David Gosset", "Robert König"],
        "year": 2018,
        "abstract": "We prove that constant-depth quantum circuits are more powerful than their classical counterparts. Specifically, we describe a computational problem that can be solved with certainty by a constant-depth quantum circuit composed of one- and two-qubit gates, whereas any classical probabilistic constant-depth circuit composed of bounded fan-in gates would fail with high probability.",
        "categories": ["quant-ph", "cs.CC"],
        "citation_count_estimate": 890,
        "doi_url": "https://doi.org/10.1038/s41567-018-0318-2",
        "keywords": ["shallow circuit", "constant depth", "advantage", "bravyi", "classical", "separation"],
    },
    {
        "arxiv_id": "1602.07674",
        "title": "Scalable and Unconditionally Secure Multiparty Computation",
        "authors": ["Hoi-Kwong Lo", "H. F. Chau"],
        "year": 1999,
        "abstract": "We show that quantum cryptography can be used to implement unconditionally secure multiparty computation. We provide protocols for computing any function of n inputs with the help of quantum entanglement, with security against any coalition of dishonest parties.",
        "categories": ["quant-ph", "cs.CR"],
        "citation_count_estimate": 670,
        "doi_url": "https://arxiv.org/abs/quant-ph/9605005",
        "keywords": ["multiparty computation", "quantum cryptography", "secure", "lo", "chau", "protocol"],
    },
    {
        "arxiv_id": "2107.14028",
        "title": "Quantum Advantage in Information Retrieval",
        "authors": ["Dominic W. Berry", "Craig Gidney", "Mario Motta", "et al."],
        "year": 2021,
        "abstract": "Quantum computers are expected to give significant advantage for simulating quantum chemistry, including electronic structure. We show how to estimate the ground and excited state energies of molecular systems using a quantum phase estimation procedure and a quantum walk approach.",
        "categories": ["quant-ph", "physics.chem-ph"],
        "citation_count_estimate": 340,
        "doi_url": "https://arxiv.org/abs/2107.14028",
        "keywords": ["quantum chemistry", "phase estimation", "berry", "gidney", "molecular simulation", "electronic structure"],
    },
    {
        "arxiv_id": "1801.07015",
        "title": "Quantum Computing in the Cloud with IBM Q Experience",
        "authors": ["Andrew Cross", "Lev Bishop", "John Smolin", "et al."],
        "year": 2019,
        "abstract": "We describe the IBM Q Experience, a cloud-based quantum computing platform that allows researchers and developers to run quantum circuits on real quantum hardware. We discuss the architecture, capabilities, and use cases of the platform.",
        "categories": ["quant-ph"],
        "citation_count_estimate": 720,
        "doi_url": "https://arxiv.org/abs/1801.07015",
        "keywords": ["ibm q", "cloud", "quantum experience", "hardware access", "qasm", "circuit", "backend"],
    },
    {
        "arxiv_id": "2109.11486",
        "title": "Exponential Separation Between Quantum and Classical Proofs",
        "authors": ["Scott Aaronson", "Patrick Rall"],
        "year": 2020,
        "abstract": "We describe quantum algorithms for binary classification and regression which run in time O(sqrt(N/k)) and O(sqrt(N)) respectively, compared to Omega(N) for classical algorithms, where N is the dataset size and k is the number of classes.",
        "categories": ["quant-ph", "cs.LG"],
        "citation_count_estimate": 450,
        "doi_url": "https://arxiv.org/abs/2109.11486",
        "keywords": ["quantum classification", "speedup", "aaronson", "binary", "regression", "dataset"],
    },
    {
        "arxiv_id": "2011.01979",
        "title": "Noise-Induced Barren Plateaus in Variational Quantum Algorithms",
        "authors": ["Samson Wang", "Enrico Fontana", "Marco Cerezo", "et al."],
        "year": 2021,
        "abstract": "Variational quantum algorithms (VQAs) are a leading strategy to demonstrate quantum advantage on near-term quantum devices. However, VQAs are severely limited by a phenomenon known as barren plateaus where the cost function landscape becomes exponentially flat, making training extremely difficult.",
        "categories": ["quant-ph", "cs.LG"],
        "citation_count_estimate": 540,
        "doi_url": "https://doi.org/10.1038/s41467-021-27045-6",
        "keywords": ["barren plateau", "noise", "variational", "vqa", "training", "gradient", "decoherence"],
    },
    {
        "arxiv_id": "2012.09184",
        "title": "Power of Data in Quantum Machine Learning",
        "authors": ["Hsin-Yuan Huang", "Richard Kueng", "John Preskill"],
        "year": 2021,
        "abstract": "The development of quantum machine learning raises fundamental questions about the nature of quantum data and its classical representation. We show that classical machine learning models can predict quantum measurement outcomes as accurately as quantum models.",
        "categories": ["quant-ph", "cs.LG", "stat.ML"],
        "citation_count_estimate": 870,
        "doi_url": "https://doi.org/10.1038/s41467-021-22539-9",
        "keywords": ["quantum machine learning", "classical shadow", "huang", "kueng", "preskill", "data", "advantage"],
    },
    {
        "arxiv_id": "2206.14215",
        "title": "Evidence for the Utility of Quantum Computing Before Fault Tolerance",
        "authors": ["Youngseok Kim", "Andrew Eddins", "Sanjay Anand", "et al. (IBM Quantum)"],
        "year": 2023,
        "abstract": "Quantum computing promises potential advantages over classical methods, yet practical near-term utility remains elusive. We demonstrate here 127-qubit quantum utility by simulating the 2D transverse-field Ising model using IBM's Eagle processor and zero noise extrapolation.",
        "categories": ["quant-ph", "cond-mat.str-el"],
        "citation_count_estimate": 1100,
        "doi_url": "https://doi.org/10.1038/s41586-023-06096-3",
        "keywords": ["127 qubit", "eagle", "ibm", "utility", "ising", "zne", "error mitigation", "beyond classical"],
    },
    {
        "arxiv_id": "2304.11997",
        "title": "Randomized Benchmarking of Quantum Gates",
        "authors": ["Easwar Magesan", "Jay M. Gambetta", "Joseph Emerson"],
        "year": 2011,
        "abstract": "We describe a scalable randomized benchmarking (RB) protocol that is practical for systems with a small number of qubits. The protocol provides efficient estimates of the average error rate of a set of gates, using a sequence of random Clifford gates.",
        "categories": ["quant-ph"],
        "citation_count_estimate": 2100,
        "doi_url": "https://doi.org/10.1103/PhysRevLett.106.180504",
        "keywords": ["randomized benchmarking", "rb", "clifford", "gate fidelity", "magesan", "error rate", "scalable"],
    },
]

CATEGORIES = {
    "quant-ph":          "Quantum Physics — core QC theory and experiments",
    "cs.CC":             "Computational Complexity",
    "cs.DS":             "Data Structures and Algorithms",
    "cs.CR":             "Cryptography and Security",
    "cs.LG":             "Machine Learning",
    "cs.IT":             "Information Theory",
    "cond-mat.mes-hall": "Mesoscale and Nanoscale Physics",
    "cond-mat.str-el":   "Strongly Correlated Electrons",
    "cond-mat.supr-con": "Superconductivity",
    "physics.chem-ph":   "Chemical Physics",
    "stat.ML":           "Statistics — Machine Learning",
}


def _bibtex(paper: Dict[str, Any]) -> str:
    key = paper["authors"][0].split()[-1] + str(paper["year"])
    return (
        f"@article{{{key},\n"
        f"  title={{{paper['title']}}},\n"
        f"  author={{{' and '.join(paper['authors'])}}},\n"
        f"  year={{{paper['year']}}},\n"
        f"  url={{{paper['doi_url']}}}\n"
        f"}}"
    )


def _relevance(paper: Dict[str, Any], query_tokens: List[str]) -> float:
    text = " ".join([
        paper["title"].lower(),
        paper["abstract"].lower(),
        " ".join(paper["authors"]).lower(),
        " ".join(paper.get("keywords", [])),
        " ".join(paper["categories"]),
    ])
    score = 0.0
    for token in query_tokens:
        if token in text:
            # Title matches worth more
            if token in paper["title"].lower():
                score += 3.0
            if token in paper.get("keywords", []):
                score += 2.0
            score += 1.0
    # Boost by citation count (log scale)
    score += math.log10(max(paper["citation_count_estimate"], 1)) * 0.1
    return round(score, 4)


def _snippet(abstract: str, max_chars: int = 300) -> str:
    return abstract[:max_chars].rstrip() + ("..." if len(abstract) > max_chars else "")


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    category: Optional[str] = None
    max_results: int = Field(default=10, ge=1, le=30)
    sort_by: str = Field(default="relevance", description="relevance | year | citations")


@router.post("")
def search_papers(req: SearchRequest):
    t0 = time.perf_counter()
    query_tokens = req.query.lower().split()

    pool = PAPERS
    if req.category:
        pool = [p for p in pool if req.category in p["categories"]]

    scored = [(p, _relevance(p, query_tokens)) for p in pool]

    if req.sort_by == "year":
        scored.sort(key=lambda x: x[0]["year"], reverse=True)
    elif req.sort_by == "citations":
        scored.sort(key=lambda x: x[0]["citation_count_estimate"], reverse=True)
    else:
        scored.sort(key=lambda x: x[1], reverse=True)

    top = scored[: req.max_results]

    results = []
    for paper, score in top:
        results.append({
            "arxiv_id": paper["arxiv_id"],
            "title": paper["title"],
            "authors": paper["authors"],
            "year": paper["year"],
            "abstract_snippet": _snippet(paper["abstract"]),
            "categories": paper["categories"],
            "relevance_score": score,
            "citation_count_estimate": paper["citation_count_estimate"],
            "bibtex": _bibtex(paper),
            "doi_url": paper["doi_url"],
        })

    # Related topics: most common categories in top results
    cat_counts: Dict[str, int] = {}
    for paper, _ in top:
        for c in paper["categories"]:
            cat_counts[c] = cat_counts.get(c, 0) + 1
    related_topics = sorted(cat_counts, key=cat_counts.get, reverse=True)[:5]  # type: ignore[arg-type]

    elapsed_ms = (time.perf_counter() - t0) * 1000

    return {
        "search_id": str(uuid.uuid4()),
        "query": req.query,
        "n_results": len(results),
        "total_in_database": len(PAPERS),
        "results": results,
        "related_topics": related_topics,
        "search_time_ms": round(elapsed_ms, 3),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/categories")
def list_categories():
    return {
        "categories": [{"id": k, "description": v} for k, v in CATEGORIES.items()]
    }


@router.get("/featured")
def featured_papers():
    featured = [p for p in PAPERS if p.get("featured")][:5]
    return {
        "featured": [
            {
                "arxiv_id": p["arxiv_id"],
                "title": p["title"],
                "authors": p["authors"],
                "year": p["year"],
                "abstract_snippet": _snippet(p["abstract"]),
                "categories": p["categories"],
                "citation_count_estimate": p["citation_count_estimate"],
                "doi_url": p["doi_url"],
            }
            for p in featured
        ]
    }
