"""Player action validation helpers shared by AI and human inputs."""

VALID_ACTIONS = {"fold", "check", "call", "raise", "all_in"}


def normalize_action(action_type: str, amount: int, available: dict) -> dict:
    """Return a legal poker action for the current available-action map."""
    action_type = str(action_type or "").lower().strip()
    try:
        amount = int(amount or 0)
    except (TypeError, ValueError):
        amount = 0

    if action_type == "check" and available.get("can_check"):
        return {"type": "check", "amount": 0}

    if action_type == "call" and available.get("can_call"):
        return {"type": "call", "amount": available.get("to_call", 0)}

    if action_type == "raise" and available.get("can_raise"):
        min_raise_to = available.get("min_raise_to", 0)
        max_raise_to = available.get("max_raise_to", 0)
        if amount < min_raise_to:
            amount = min_raise_to
        elif amount > max_raise_to:
            amount = max_raise_to
        return {"type": "raise", "amount": amount}

    if action_type == "all_in" and available.get("can_all_in"):
        return {"type": "all_in", "amount": 0}

    if action_type == "fold":
        return {"type": "fold", "amount": 0}

    if available.get("can_check"):
        return {"type": "check", "amount": 0}
    if available.get("can_call"):
        return {"type": "call", "amount": available.get("to_call", 0)}
    return {"type": "fold", "amount": 0}
