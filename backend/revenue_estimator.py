"""
CompeteAI - Revenue Estimator
Uses BSR (Best Seller Rank) → Monthly Sales → Monthly Revenue estimation.
Based on publicly documented formulas used by tools like Jungle Scout.

FIX: No longer sorts by revenue — preserves original rank order.
     Frontend sorts by rank for display. This prevents rank/revenue mismatch.
"""

CATEGORY_MULTIPLIERS = {
    "books": 0.8,
    "electronics": 1.2,
    "clothing": 0.9,
    "home": 1.0,
    "kitchen": 1.1,
    "sports": 1.0,
    "toys": 1.0,
    "health": 1.1,
    "beauty": 1.0,
    "grocery": 0.9,
    "default": 1.0,
}


def estimate_monthly_sales(bsr: int, category: str = "default") -> int:
    if not bsr or bsr <= 0:
        return 0

    multiplier = CATEGORY_MULTIPLIERS.get(category.lower(), 1.0)

    if bsr <= 10:
        daily = 3000
    elif bsr <= 100:
        daily = 3000 / (bsr ** 0.7)
    elif bsr <= 1000:
        daily = 500 / (bsr ** 0.5)
    elif bsr <= 10000:
        daily = 100 / (bsr ** 0.35)
    elif bsr <= 100000:
        daily = 30 / (bsr ** 0.2)
    else:
        daily = max(1, 10 / (bsr ** 0.15))

    monthly_sales = int(daily * 30 * multiplier)
    return max(1, monthly_sales)


def estimate_revenue(bsr: int, price: float, category: str = "default") -> dict:
    monthly_sales = estimate_monthly_sales(bsr, category)
    monthly_revenue = round(monthly_sales * price, 2)
    daily_sales = max(1, monthly_sales // 30)

    return {
        "monthly_sales": monthly_sales,
        "monthly_revenue": monthly_revenue,
        "daily_sales": daily_sales,
        "annualized_revenue": round(monthly_revenue * 12, 2),
    }


def estimate_market_size(products: list) -> dict:
    total_monthly_revenue = 0
    total_monthly_sales = 0
    product_revenues = []

    for idx, p in enumerate(products):
        result = estimate_revenue(
            bsr=p.get("bsr", 0),
            price=p.get("price", 0),
            category=p.get("category", "default"),
        )
        product_revenues.append({
            "rank": p.get("rank", idx + 1),
            "title": p.get("title", "Unknown"),
            "asin": p.get("asin", ""),
            "price": p.get("price", 0),
            "bsr": p.get("bsr", 0),
            "rating": p.get("rating", 0),
            "review_count": p.get("review_count", 0),
            "data_source": p.get("data_source", "unknown"),
            **result,
        })
        total_monthly_revenue += result["monthly_revenue"]
        total_monthly_sales += result["monthly_sales"]

    # KEY FIX: Sort by rank (ascending) NOT by revenue.
    # Revenue sort detaches rank numbers from their correct products.
    # Frontend app.js already sorts by rank for display.
    product_revenues.sort(key=lambda x: x["rank"])

    return {
        "total_monthly_revenue": round(total_monthly_revenue, 2),
        "total_annual_revenue": round(total_monthly_revenue * 12, 2),
        "total_monthly_sales": total_monthly_sales,
        "product_count": len(products),
        "avg_price": round(
            sum(p.get("price", 0) for p in products) / max(len(products), 1), 2
        ),
        "products": product_revenues,
    }