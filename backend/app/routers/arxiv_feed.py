from __future__ import annotations
import uuid, random
from datetime import datetime, timezone
from typing import Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/arxiv-feed", tags=["arxiv_feed"])

_PAPERS = [
    {"arxiv_id": "2401.00001", "title": "Quantum Error Correction with Bosonic Codes: A Review", "authors": ["Noh, K.", "Jiang, L."], "abstract": "We review bosonic quantum error correction codes including cat qubits, GKP, and binomial codes, discussing their strengths and hardware implementations.", "categories": ["quant-ph"], "date": "2024-01-02", "citations": 142, "journal": "PRX Quantum"},
    {"arxiv_id": "2401.00002", "title": "Fault-Tolerant Quantum Computing with Color Codes", "authors": ["Bombin, H.", "Pato, G."], "abstract": "We present a transversal implementation of all Clifford gates using 2D color codes, reducing the overhead of magic state distillation.", "categories": ["quant-ph"], "date": "2024-01-03", "citations": 89, "journal": "Nature Physics"},
    {"arxiv_id": "2401.00003", "title": "VQE with Hardware-Efficient Ansatz for Molecular Simulation", "authors": ["Kandala, A.", "Mezzacapo, A."], "abstract": "We demonstrate a hardware-efficient variational eigensolver on a 6-qubit processor achieving chemical accuracy for BeH2 and H2O molecules.", "categories": ["quant-ph", "chem-ph"], "date": "2024-01-05", "citations": 312, "journal": "Nature"},
    {"arxiv_id": "2401.00004", "title": "Quantum Advantage in Linear Algebra via HHL Algorithm", "authors": ["Harrow, A.", "Hassidim, A.", "Lloyd, S."], "abstract": "We extend the HHL algorithm for sparse linear systems, demonstrating exponential speedup with improved condition number bounds.", "categories": ["quant-ph", "cs.DS"], "date": "2024-01-08", "citations": 78, "journal": "PRL"},
    {"arxiv_id": "2401.00005", "title": "Randomized Benchmarking of Surface Code Logical Qubits", "authors": ["Krinner, S.", "Lacroix, N."], "abstract": "We perform logical randomized benchmarking on a 17-qubit surface code, achieving logical error rate of 3.6e-4 per logical operation.", "categories": ["quant-ph"], "date": "2024-01-10", "citations": 204, "journal": "Nature"},
    {"arxiv_id": "2401.00006", "title": "Quantum Machine Learning with Kernel Methods", "authors": ["Schuld, M.", "Killoran, N."], "abstract": "We demonstrate that quantum kernels can provide provable advantages on specific learning tasks using feature maps inaccessible to classical methods.", "categories": ["quant-ph", "cs.LG"], "date": "2024-01-12", "citations": 188, "journal": "Quantum"},
    {"arxiv_id": "2401.00007", "title": "Noise-Resilient Quantum Simulation of Ising Models", "authors": ["Stanisic, S.", "Bosse, J.L."], "abstract": "Zero-noise extrapolation combined with probabilistic error cancellation achieves subchemical accuracy for 50-qubit Ising chain simulation.", "categories": ["quant-ph"], "date": "2024-01-15", "citations": 94, "journal": "PRX Quantum"},
    {"arxiv_id": "2401.00008", "title": "QAOA Performance on MaxCut: Warm-Starting Strategies", "authors": ["Egger, D.J.", "Marecek, J.", "Woerner, S."], "abstract": "We show that warm-starting QAOA with SDP relaxation solutions achieves approximation ratio 0.87 for 3-regular graphs at depth p=2.", "categories": ["quant-ph", "cs.DS"], "date": "2024-01-18", "citations": 71, "journal": "Quantum"},
    {"arxiv_id": "2401.00009", "title": "Quantum Advantage via Boson Sampling on a 216-Photon Chip", "authors": ["Zhong, H.S.", "Wang, H."], "abstract": "We report Gaussian boson sampling on a 216-mode photonic chip that achieves total photon number up to 113, verifying quantum advantage against classical simulation.", "categories": ["quant-ph"], "date": "2024-01-20", "citations": 521, "journal": "Science"},
    {"arxiv_id": "2401.00010", "title": "Magic State Distillation: Overcoming the 15-to-1 Barrier", "authors": ["Haah, J.", "Hastings, M.B."], "abstract": "We present a new distillation protocol achieving 10-to-1 overhead for T gates, reducing T factory costs in fault-tolerant architectures by 33%.", "categories": ["quant-ph"], "date": "2024-01-22", "citations": 135, "journal": "Quantum"},
    {"arxiv_id": "2401.00011", "title": "Cross-Platform Benchmarking of 100+ Qubit Quantum Computers", "authors": ["Pelofske, E.", "Baertschi, A.", "Eidenbenz, S."], "abstract": "We benchmark 10 quantum processors from IBM, Google, and IonQ on the same problem set, revealing systematic differences in error profiles and connectivity.", "categories": ["quant-ph"], "date": "2024-01-25", "citations": 167, "journal": "PRX Quantum"},
    {"arxiv_id": "2401.00012", "title": "Quantum Sensing with NV Centers: Achieving Heisenberg Limit", "authors": ["Degen, C.L.", "Reinhard, F.", "Cappellaro, P."], "abstract": "Using adaptive quantum phase estimation on diamond NV center ensembles, we achieve Heisenberg-limited magnetic field sensing at 300K.", "categories": ["quant-ph", "cond-mat.mes-hall"], "date": "2024-01-28", "citations": 98, "journal": "Nature Physics"},
    {"arxiv_id": "2401.00013", "title": "Tensor Network Simulation of 2D Quantum Systems at Scale", "authors": ["Gray, J.", "Vidal, G."], "abstract": "We demonstrate PEPS contraction of 20x20 lattice systems on classical GPUs, enabling accurate ground state computation for the 2D Heisenberg model.", "categories": ["quant-ph", "cond-mat.str-el"], "date": "2024-02-01", "citations": 112, "journal": "Physical Review B"},
    {"arxiv_id": "2401.00014", "title": "Post-Quantum Cryptography Standards: A Practical Analysis", "authors": ["Bernstein, D.J.", "Lange, T."], "abstract": "We analyze the NIST PQC finalists CRYSTALS-Kyber and CRYSTALS-Dilithium, evaluating their quantum security margins and implementation performance.", "categories": ["quant-ph", "cs.CR"], "date": "2024-02-03", "citations": 289, "journal": "IEEE S&P"},
    {"arxiv_id": "2401.00015", "title": "Quantum Network Architecture for Distributed Quantum Computing", "authors": ["Wehner, S.", "Elkouss, D.", "Hanson, R."], "abstract": "We present a layered quantum network stack enabling distributed quantum computing over metropolitan-scale quantum networks with entanglement purification.", "categories": ["quant-ph"], "date": "2024-02-05", "citations": 347, "journal": "Science"},
    {"arxiv_id": "2401.00016", "title": "Variational Quantum Eigensolver for Nuclear Structure", "authors": ["Dumitrescu, E.F.", "McCaskey, A.J."], "abstract": "We apply VQE to deuteron binding energy calculation on IBM hardware, achieving binding energy of -2.224 MeV with 0.13 MeV accuracy.", "categories": ["quant-ph", "nucl-th"], "date": "2024-02-08", "citations": 203, "journal": "PRL"},
    {"arxiv_id": "2401.00017", "title": "Quantum Approximate Optimization for Portfolio Rebalancing", "authors": ["Woerner, S.", "Egger, D.J."], "abstract": "QAOA applied to Markowitz portfolio optimization achieves 0.95 Sharpe ratio vs classical 0.91 on 8-asset portfolios using 5 QAOA layers.", "categories": ["quant-ph", "q-fin"], "date": "2024-02-10", "citations": 88, "journal": "Quantum Finance"},
    {"arxiv_id": "2401.00018", "title": "Fault-Tolerant Quantum Memory for 24 Hours with Superconducting Qubits", "authors": ["Sivak, V.V.", "Eickbusch, A."], "abstract": "We demonstrate a bosonic cat-qubit achieving logical error rate below 10^-4 per hour, enabling fault-tolerant quantum memory for 24 continuous hours.", "categories": ["quant-ph"], "date": "2024-02-12", "citations": 415, "journal": "Nature"},
    {"arxiv_id": "2401.00019", "title": "Quantum Amplitude Estimation without Phase Estimation", "authors": ["Brassard, G.", "Hoyer, P."], "abstract": "We present QAE based on maximum likelihood estimation, achieving epsilon-precision with O(1/epsilon) queries and no phase estimation overhead.", "categories": ["quant-ph"], "date": "2024-02-15", "citations": 156, "journal": "ACM STOC"},
    {"arxiv_id": "2401.00020", "title": "Dynamical Decoupling for Superconducting Qubit Coherence Extension", "authors": ["Pokharel, B.", "Anand, N."], "abstract": "XY-8 dynamical decoupling sequences extend T2 coherence time by 5x on transmon qubits without calibration overhead.", "categories": ["quant-ph"], "date": "2024-02-18", "citations": 74, "journal": "PRApplied"},
]

CATEGORIES = {
    "quant-ph": "Quantum Physics",
    "cs.DS": "Data Structures & Algorithms",
    "cs.LG": "Machine Learning",
    "chem-ph": "Chemical Physics",
    "cond-mat.mes-hall": "Mesoscale/Nanoscale Physics",
    "cond-mat.str-el": "Strongly Correlated Electrons",
    "nucl-th": "Nuclear Theory",
    "cs.CR": "Cryptography",
    "q-fin": "Quantitative Finance",
}

class FeedRequest(BaseModel):
    query: str = ""
    categories: List[str] = []
    max_results: int = Field(default=10, ge=1, le=50)
    sort_by: str = "citations"
    since_days: int = Field(default=90, ge=1, le=3650)

@router.post("")
def search_papers(req: FeedRequest):
    papers = list(_PAPERS)
    query_lower = req.query.lower()
    if query_lower:
        papers = [p for p in papers if query_lower in p["title"].lower() or query_lower in p["abstract"].lower()]
    if req.categories:
        papers = [p for p in papers if any(c in p["categories"] for c in req.categories)]
    if req.sort_by == "citations":
        papers.sort(key=lambda p: p["citations"], reverse=True)
    elif req.sort_by == "date":
        papers.sort(key=lambda p: p["date"], reverse=True)
    papers = papers[:req.max_results]

    total_found = len(list(_PAPERS))
    trending = sorted(_PAPERS, key=lambda p: p["citations"], reverse=True)[:3]

    return {
        "feed_id": str(uuid.uuid4()),
        "query": req.query,
        "total_found": total_found,
        "returned": len(papers),
        "papers": papers,
        "trending_papers": trending,
        "categories_available": list(CATEGORIES.keys()),
        "stats": {
            "total_papers_indexed": len(_PAPERS),
            "avg_citations": round(sum(p["citations"] for p in _PAPERS)/len(_PAPERS), 1),
            "most_cited": max(_PAPERS, key=lambda p: p["citations"])["title"],
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

@router.get("/categories")
def list_categories():
    return {"categories": [{"id": k, "name": v} for k, v in CATEGORIES.items()]}

@router.get("/trending")
def get_trending():
    top5 = sorted(_PAPERS, key=lambda p: p["citations"], reverse=True)[:5]
    return {"trending": top5, "as_of": datetime.now(timezone.utc).isoformat()}
