"""Tests for EvaluationContext."""


from toggly import EvaluationContext, HttpRequestMapper, RequestContext


class TestEvaluationContext:
    """Tests for EvaluationContext class."""

    def test_context_default_initialization(self) -> None:
        """Test context with default values."""
        context = EvaluationContext()

        assert context.identity is None
        assert context.groups == []
        assert context.traits == {}
        assert context.claims == {}
        assert context.request is None

    def test_context_with_identity(self) -> None:
        """Test context with identity."""
        context = EvaluationContext(identity="user-123")

        assert context.identity == "user-123"
        assert context.groups == []
        assert context.traits == {}

    def test_context_with_groups(self) -> None:
        """Test context with groups."""
        context = EvaluationContext(groups=["beta", "premium"])

        assert context.identity is None
        assert context.groups == ["beta", "premium"]
        assert context.traits == {}

    def test_context_with_traits(self) -> None:
        """Test context with traits."""
        context = EvaluationContext(traits={"country": "US", "plan": "enterprise"})

        assert context.identity is None
        assert context.groups == []
        assert context.traits == {"country": "US", "plan": "enterprise"}

    def test_context_with_claims_and_request(self) -> None:
        """Test context with claims and request fields."""
        request = RequestContext(user_agent="UA", accept_language="en-US", country="US")
        context = EvaluationContext(
            identity="user-123",
            claims={"role": "admin"},
            request=request,
        )

        assert context.claims == {"role": "admin"}
        assert context.request is not None
        assert context.request.country == "US"

    def test_context_with_all_fields(self) -> None:
        """Test context with all fields."""
        context = EvaluationContext(
            identity="user-123",
            groups=["beta-testers", "premium"],
            traits={"country": "US", "plan": "enterprise"}
        )

        assert context.identity == "user-123"
        assert context.groups == ["beta-testers", "premium"]
        assert context.traits == {"country": "US", "plan": "enterprise"}

    def test_with_identity_creates_new_context(self) -> None:
        """Test with_identity creates a new context."""
        original = EvaluationContext(groups=["admin"], claims={"role": "admin"})
        new_context = original.with_identity("user-456")

        assert original.identity is None
        assert new_context.identity == "user-456"
        assert new_context.groups == ["admin"]
        assert new_context.claims == {"role": "admin"}

    def test_with_groups_creates_new_context(self) -> None:
        """Test with_groups creates a new context."""
        original = EvaluationContext(identity="user-123", groups=["beta"])
        new_context = original.with_groups("premium", "vip")

        assert original.groups == ["beta"]
        assert set(new_context.groups) == {"beta", "premium", "vip"}
        assert new_context.identity == "user-123"

    def test_with_traits_creates_new_context(self) -> None:
        """Test with_traits creates a new context."""
        original = EvaluationContext(
            identity="user-123",
            traits={"country": "US"}
        )
        new_context = original.with_traits(plan="premium")

        assert original.traits == {"country": "US"}
        assert new_context.traits == {"country": "US", "plan": "premium"}

    def test_with_traits_overwrites_existing(self) -> None:
        """Test with_traits overwrites existing traits."""
        original = EvaluationContext(traits={"country": "US"})
        new_context = original.with_traits(country="UK")

        assert original.traits == {"country": "US"}
        assert new_context.traits == {"country": "UK"}

    def test_to_dict(self) -> None:
        """Test to_dict conversion."""
        context = EvaluationContext(
            identity="user-123",
            groups=["beta"],
            traits={"country": "US"}
        )
        result = context.to_dict()

        assert result == {
            "identity": "user-123",
            "groups": ["beta"],
            "traits": {"country": "US"},
            "claims": {},
            "request": None,
            "entity": None,
        }

    def test_from_dict(self) -> None:
        """Test from_dict creation."""
        data = {
            "identity": "user-123",
            "groups": ["beta"],
            "traits": {"country": "US"},
            "claims": {"role": "admin"},
            "request": {"userAgent": "UA", "country": "US"},
        }
        context = EvaluationContext.from_dict(data)

        assert context.identity == "user-123"
        assert context.groups == ["beta"]
        assert context.traits == {"country": "US"}
        assert context.claims == {"role": "admin"}
        assert context.request is not None
        assert context.request.user_agent == "UA"
        assert context.request.country == "US"

    def test_from_dict_with_missing_fields(self) -> None:
        """Test from_dict with missing fields uses defaults."""
        context = EvaluationContext.from_dict({})

        assert context.identity is None
        assert context.groups == []
        assert context.traits == {}
        assert context.claims == {}
        assert context.request is None

    def test_anonymous_factory(self) -> None:
        """Test anonymous factory method."""
        context = EvaluationContext.anonymous()

        assert context.identity is None
        assert context.groups == []
        assert context.traits == {}

    def test_bool_false_for_empty_context(self) -> None:
        """Test bool returns False for empty context."""
        context = EvaluationContext()
        assert not context

    def test_bool_true_with_identity(self) -> None:
        """Test bool returns True with identity."""
        context = EvaluationContext(identity="user-123")
        assert context

    def test_bool_true_with_groups(self) -> None:
        """Test bool returns True with groups."""
        context = EvaluationContext(groups=["beta"])
        assert context

    def test_bool_true_with_traits(self) -> None:
        """Test bool returns True with traits."""
        context = EvaluationContext(traits={"country": "US"})
        assert context

    def test_bool_true_with_claims(self) -> None:
        """Test bool returns True with claims."""
        context = EvaluationContext(claims={"role": "admin"})
        assert context

    def test_immutability_of_groups(self) -> None:
        """Test that groups list is copied."""
        original_groups = ["beta"]
        context = EvaluationContext(groups=original_groups)
        original_groups.append("admin")

        new_context = context.with_groups("vip")
        assert "beta" in new_context.groups
        assert "vip" in new_context.groups

    def test_immutability_of_traits(self) -> None:
        """Test that traits dict is copied."""
        original_traits = {"country": "US"}
        context = EvaluationContext(traits=original_traits)
        original_traits["country"] = "UK"

        new_context = context.with_traits(plan="premium")
        assert "plan" in new_context.traits


class TestHttpRequestMapper:
    """Tests for HTTP header → RequestContext mapping."""

    def test_maps_user_agent_and_accept_language(self) -> None:
        """Test standard header mapping."""
        request = HttpRequestMapper.from_http_headers(
            {
                "User-Agent": "Mozilla/5.0",
                "Accept-Language": "en-US",
            }
        )
        assert request.user_agent == "Mozilla/5.0"
        assert request.accept_language == "en-US"

    def test_country_prefers_cf_ipcountry(self) -> None:
        """Test CF-IPCountry wins for country."""
        request = HttpRequestMapper.from_http_headers(
            {
                "cf-ipcountry": "US",
                "x-vercel-ip-country": "DE",
            }
        )
        assert request.country == "US"

    def test_merge_into_preserves_identity(self) -> None:
        """Test merge_into keeps identity/groups/claims."""
        base = EvaluationContext(identity="u", groups=["beta"], claims={"role": "admin"})
        merged = HttpRequestMapper.merge_into({"cf-ipcountry": "US"}, base)
        assert merged.identity == "u"
        assert merged.groups == ["beta"]
        assert merged.claims == {"role": "admin"}
        assert merged.request is not None
        assert merged.request.country == "US"
