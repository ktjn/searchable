def generate_deletes(term: str, max_edits: int) -> list[str]:
    frontier = {term}
    all_variants = set(frontier)
    for _ in range(max_edits):
        next_frontier: set[str] = set()
        for variant in frontier:
            chars = list(variant)
            for index in range(len(chars)):
                next_frontier.add("".join(chars[:index] + chars[index + 1 :]))
        all_variants.update(next_frontier)
        frontier = next_frontier
    return list(all_variants)
