defmodule Toggly.Variant do
  @moduledoc """
  MF-parity feature variant assignment.

  Assigns a variant locally from the definitions catalog (the same
  `filters` + `variants` + `allocation` map already used by
  `Toggly.Evaluator`), matching `Microsoft.FeatureManagement`
  (`IVariantFeatureManager`) bit-for-bit for the same feature definition,
  enabled state, and targeting context. See the `variant-allocator-corpus`
  gold corpus this module is verified against, and the design doc for the
  full algorithm writeup:
  `Toggly.wiki/Home/Engineering/Plans/2026-09-23-Catalog-Local-Backend-Variants-Design.md`.
  """

  defmodule Assignment do
    @moduledoc "Result of assigning a variant for one feature + context."

    @type t :: %__MODULE__{
            variant_name: String.t() | nil,
            configuration_value: term(),
            enabled: boolean(),
            assignment_reason: String.t()
          }

    defstruct variant_name: nil,
              configuration_value: nil,
              enabled: false,
              assignment_reason: "None"
  end

  @doc """
  Assign a variant for `definition` given the targeting `context`.

  Options:

    * `:ignore_case` - case-insensitive user/group matching, mirroring
      `Microsoft.FeatureManagement`'s `TargetingEvaluationOptions.IgnoreCase`
      (default `false`; a service-level assigner option, not part of the
      feature definition itself).
  """
  @spec assign(map(), Toggly.Context.t(), keyword()) :: Assignment.t()
  def assign(definition, context, options \\ []) do
    filter_enabled = Toggly.Evaluator.evaluate(definition, context)
    variants = Map.get(definition, "variants", [])

    # No variants defined at all: the assignment pipeline never runs.
    if variants in [nil, []] do
      %Assignment{enabled: filter_enabled, assignment_reason: "None"}
    else
      ignore_case = Keyword.get(options, :ignore_case, false)
      allocation = Map.get(definition, "allocation")

      {variant_name, reason} =
        resolve(allocation, filter_enabled, definition, context, ignore_case)

      variant = Enum.find(variants, &(&1["name"] == variant_name))

      %Assignment{
        variant_name: variant_name,
        configuration_value: variant && Map.get(variant, "configurationValue"),
        enabled: effective_enabled(variant, filter_enabled),
        assignment_reason: reason
      }
    end
  rescue
    _ -> %Assignment{enabled: false, assignment_reason: "None"}
  end

  defp effective_enabled(nil, filter_enabled), do: filter_enabled

  defp effective_enabled(variant, filter_enabled) do
    case variant["statusOverride"] do
      "Enabled" -> true
      "Disabled" -> false
      _ -> filter_enabled
    end
  end

  # No allocation configured: no variant assigned (reason DefaultWhen* only).
  defp resolve(nil, filter_enabled, _definition, _context, _ignore_case),
    do: {nil, if(filter_enabled, do: "DefaultWhenEnabled", else: "DefaultWhenDisabled")}

  # Disabled feature: only DefaultWhenDisabled runs; user/group/percentile do not.
  defp resolve(allocation, false, _definition, _context, _ignore_case),
    do: {allocation["defaultWhenDisabled"], "DefaultWhenDisabled"}

  # Enabled feature: user -> group -> percentile -> DefaultWhenEnabled, in order.
  defp resolve(allocation, true, definition, context, ignore_case) do
    identity = context["identity"]
    groups = context["groups"] || []
    feature_key = definition["featureKey"]

    match_user(allocation["user"], identity, ignore_case) ||
      match_group(allocation["group"], groups, ignore_case) ||
      match_percentile(
        allocation["percentile"],
        allocation["seed"],
        feature_key,
        identity,
        ignore_case
      ) ||
      {allocation["defaultWhenEnabled"], "DefaultWhenEnabled"}
  end

  defp match_user(rules, identity, ignore_case)
       when is_list(rules) and is_binary(identity) and identity != "" do
    Enum.find_value(rules, fn rule ->
      if member?(rule["users"] || [], identity, ignore_case), do: {rule["variant"], "User"}
    end)
  end

  defp match_user(_rules, _identity, _ignore_case), do: nil

  defp match_group(rules, groups, ignore_case) when is_list(rules) do
    Enum.find_value(rules, fn rule ->
      candidates = rule["groups"] || []
      if Enum.any?(groups, &member?(candidates, &1, ignore_case)), do: {rule["variant"], "Group"}
    end)
  end

  defp match_group(_rules, _groups, _ignore_case), do: nil

  defp match_percentile(rules, seed, feature_key, identity, ignore_case) when is_list(rules) do
    percentage = percentile(identity || "", feature_key, seed, ignore_case)

    Enum.find_value(rules, fn rule ->
      if bucket_matches?(percentage, rule["from"], rule["to"]),
        do: {rule["variant"], "Percentile"}
    end)
  end

  defp match_percentile(_rules, _seed, _feature_key, _identity, _ignore_case), do: nil

  # `from <= pct < to`, except `to == 100` is inclusive-from / unbounded-above
  # (matches `Microsoft.FeatureManagement.FeatureFilters.TargetingEvaluator`).
  defp bucket_matches?(pct, from, to) when to >= 100, do: pct >= from
  defp bucket_matches?(pct, from, to), do: pct >= from and pct < to

  # SHA-256 over `{userId}\n{hint}` (custom seed, else the implicit default
  # `allocation\n{featureKey}`); first 4 digest bytes as a little-endian
  # uint32, scaled to a `[0, 100]` percentage. `userId` is lowercased first
  # when `ignore_case` is set (MF lowercases the assigner's targeting id).
  defp percentile(identity, feature_key, seed, ignore_case) do
    identity = if ignore_case, do: String.downcase(identity), else: identity
    hint = seed || "allocation\n#{feature_key}"
    <<value::little-unsigned-32, _::binary>> = :crypto.hash(:sha256, identity <> "\n" <> hint)
    value / 0xFFFFFFFF * 100
  end

  defp member?(candidates, value, true),
    do: Enum.any?(candidates, &(String.downcase(to_string(&1)) == String.downcase(value)))

  defp member?(candidates, value, false), do: value in candidates
end
