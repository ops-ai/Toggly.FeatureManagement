defmodule Toggly.Evaluator do
  @moduledoc "Canonical local filter evaluation. Unknown or malformed filters fail closed."
  @spec percentile(String.t(), String.t()) :: float()
  def percentile(identity, key) do
    <<value::little-unsigned-32, _::binary>> = :crypto.hash(:sha256, key <> "\n" <> identity)
    value / 0xFFFFFFFF * 100
  end

  @spec evaluate(map(), Toggly.Context.t()) :: boolean()
  def evaluate(definition, context) do
    filters = Map.get(definition, "filters", [])
    {entity, user} = Enum.split_with(filters, &(name(&1) == "ContextProperty"))
    requirement = Map.get(definition, "requirementType", "Any")

    entity_pass =
      entity == [] or
        (valid_entity?(definition, context) and
           group(
             entity,
             Map.get(definition, "contextRequirementType", requirement),
             definition,
             context
           ))

    entity_pass and
      if user == [], do: entity != [], else: group(user, requirement, definition, context)
  rescue
    _ -> false
  end

  defp valid_entity?(definition, context) do
    entity = context["entity"]

    is_map(entity) and
      (is_nil(definition["contextKind"]) or definition["contextKind"] == entity["kind"])
  end

  defp group(filters, requirement, definition, context) do
    callback =
      &filter(name(&1), Map.get(&1, "parameters", %{}), definition["featureKey"], context)

    if requirement == "All", do: Enum.all?(filters, callback), else: Enum.any?(filters, callback)
  end

  defp name(f), do: f["name"] |> String.replace_prefix("Microsoft.", "")
  defp filter("AlwaysOn", _, _, _), do: true
  defp filter("AlwaysOff", _, _, _), do: false

  defp filter("Percentage", p, key, c),
    do: percentage(p["Value"] || p["Percentage"], key, c, false)

  defp filter("TimeWindow", p, _, c) do
    now = instant(c["now"] || DateTime.to_iso8601(DateTime.utc_now()))

    (blank?(p["Start"]) or (instant(p["Start"]) != nil and now >= instant(p["Start"]))) and
      (blank?(p["End"]) or (instant(p["End"]) != nil and now <= instant(p["End"])))
  end

  defp filter("Targeting", p, key, c) do
    ignore = p["IgnoreCase"] not in [false, "false", "False", "0"]
    identity = c["identity"] || ""
    groups = c["groups"] || []

    excluded =
      member?(values(p, "Audience.Exclusion.Users"), identity, ignore) or
        Enum.any?(groups, &member?(values(p, "Audience.Exclusion.Groups"), &1, ignore))

    not excluded and
      (member?(values(p, "Audience.Users"), identity, ignore) or
         Enum.any?(groups, &member?(values(p, "Audience.Groups"), &1, ignore)) or
         percentage(p["Audience.DefaultRolloutPercentage"] || p["Percentage"], key, c, false))
  end

  defp filter("ContextProperty", p, _, c),
    do: context_property(p, c["entity"]["attributes"] || %{})

  defp filter(name, p, key, c)
       when name in [
              "UserClaims",
              "Country",
              "CountryFamily",
              "BrowserLanguage",
              "BrowserFamily",
              "DeviceType",
              "OperatingSystem",
              "OS"
            ] do
    percentage(p["Percentage"], key, c, true) and segment(name, p, c)
  end

  defp filter(_, _, _, _), do: false

  defp percentage(raw, key, c, anonymous_random) do
    value = number(raw) || 0

    cond do
      value <= 0 -> false
      value >= 100 -> true
      is_binary(c["identity"]) and c["identity"] != "" -> percentile(c["identity"], key) < value
      anonymous_random -> :rand.uniform() * 100 < value
      true -> false
    end
  end

  defp segment("UserClaims", p, c),
    do:
      not blank?(p["Claim"]) and not blank?(p["Value"]) and
        get_in(c, ["claims", p["Claim"]]) == p["Value"]

  defp segment(name, p, c) when name in ["Country", "CountryFamily"],
    do: member?(values(p, "Country"), get_in(c, ["request", "country"]) || "", true)

  defp segment("BrowserLanguage", p, c),
    do:
      contains_any?(get_in(c, ["request", "acceptLanguage"]) || "", values(p, "BrowserLanguage"))

  defp segment(name, p, c) do
    ua = UAParser.parse(get_in(c, ["request", "userAgent"]) || "")

    {field, prefix} =
      case name do
        "BrowserFamily" ->
          {ua.family, "BrowserFamily"}

        "DeviceType" ->
          {if(ua.device.family == "Mac", do: "Macintosh", else: ua.device.family), "DeviceType"}

        _ ->
          {ua.os.family, "OperatingSystem"}
      end

    field not in [nil, "Other"] and contains_any?(field, values(p, prefix))
  end

  defp values(p, prefix) do
    colon = String.replace(prefix, ".", ":")

    for {key, value} <- p,
        String.starts_with?(key, prefix <> ":") or String.starts_with?(key, colon <> ":"),
        is_binary(value),
        value != "",
        do: value
  end

  defp member?(items, value, ignore),
    do:
      value != "" and
        Enum.any?(items, &if(ignore, do: lower(&1) == lower(value), else: &1 == value))

  defp contains_any?(actual, expected),
    do: Enum.any?(expected, &String.contains?(lower(actual), lower(&1)))

  defp lower(value), do: value |> to_string() |> String.downcase()
  defp blank?(value), do: value in [nil, ""]
  defp number(value) when is_number(value), do: value

  defp number(value) when is_binary(value) do
    case Float.parse(value) do
      {number, ""} -> number
      _ -> nil
    end
  end

  defp number(_), do: nil

  defp instant(value) do
    case DateTime.from_iso8601(value) do
      {:ok, date, _} -> DateTime.to_unix(date, :microsecond)
      _ -> nil
    end
  end

  defp context_property(params, attributes) do
    p = Map.new(params, fn {k, v} -> {String.downcase(k), v} end)
    found = Enum.find(attributes, fn {k, _} -> lower(k) == lower(p["property"]) end)

    case found do
      {_, actual} when not is_nil(actual) ->
        compare(actual, p["value"], lower(p["operator"]), lower(p["valuetype"] || "string"))

      _ ->
        false
    end
  end

  defp compare(_, nil, _, _), do: false
  defp compare(actual, expected, "eq", _), do: lower(actual) == lower(expected)
  defp compare(actual, expected, "neq", _), do: lower(actual) != lower(expected)

  defp compare(actual, expected, "in", _),
    do:
      member?(
        String.split(to_string(expected), ",") |> Enum.map(&String.trim/1),
        to_string(actual),
        true
      )

  defp compare(actual, expected, "contains", "string[]") when is_list(actual),
    do: member?(Enum.map(actual, &to_string/1), to_string(expected), true)

  defp compare(_, _, "contains", "string[]"), do: false

  defp compare(actual, expected, "contains", _),
    do: String.contains?(lower(actual), lower(expected))

  defp compare(actual, expected, op, type)
       when op in ["gt", "gte", "lt", "lte"] and type in ["number", "datetime"] do
    parse = if type == "number", do: &number/1, else: &instant/1
    a = parse.(actual)
    b = parse.(expected)

    not is_nil(a) and not is_nil(b) and
      case op do
        "gt" -> a > b
        "gte" -> a >= b
        "lt" -> a < b
        "lte" -> a <= b
      end
  end

  defp compare(_, _, _, _), do: false
end
