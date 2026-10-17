defmodule Toggly.SystemMetrics do
  @moduledoc false

  @interval_ms 10_000
  @max_pending 30

  def interval_ms(opts), do: Keyword.get(opts, :system_metrics_interval_ms, @interval_ms)

  def max_pending, do: @max_pending

  @type sample :: {String.t(), number()}
  @type cpu_snapshot :: {non_neg_integer(), non_neg_integer()}

  @doc """
  Cumulative `{runtime_ms, wall_clock_ms}` from `:erlang.statistics/1`.

  Prefer these totals over the since-last-call deltas — those counters are
  global and reset on every reader, so concurrent clients skew each other.
  """
  @spec cpu_snapshot() :: cpu_snapshot()
  def cpu_snapshot do
    {runtime_ms, _delta} = :erlang.statistics(:runtime)
    {wall_ms, _delta} = :erlang.statistics(:wall_clock)
    {runtime_ms, wall_ms}
  end

  @doc """
  Default process samples. `exception_count` is consumed (zeroed in the returned count).
  Pass the previous `cpu_snapshot/0` (or `nil` on first sample) so CpuUsage uses
  cumulative totals instead of the global since-last-call deltas.
  """
  @spec default_sample(non_neg_integer(), cpu_snapshot() | nil) ::
          {non_neg_integer(), [sample()], cpu_snapshot()}
  def default_sample(exception_count, prev_cpu \\ nil) do
    {cpu_pct, next_cpu} = sample_cpu(prev_cpu)

    samples =
      []
      |> maybe_add("CpuUsage", cpu_pct)
      |> maybe_add("GCHeapSize", sample_gc_heap())
      |> maybe_add("ProcessCount", sample_process_count())
      |> maybe_add("MemoryWorkingSet", sample_memory_working_set())
      |> maybe_add_exception(exception_count)

    # Keep the exception count until the client confirms ExceptionCount was
    # accepted under the pending cap (see Client.sample_system_metrics/1).
    {exception_count, samples, next_cpu}
  end

  def attach_exception_handler(client_name, client_pid) do
    id = handler_id(client_name)
    config = %{config: %{client: client_pid}}

    case :logger.add_handler(id, Toggly.SystemMetrics.LogHandler, config) do
      :ok ->
        :ok

      {:error, {:already_exists, _}} ->
        # Client may have crashed without terminate/2; replace the handler so
        # ExceptionCount keeps routing to the live GenServer.
        _ = :logger.remove_handler(id)

        case :logger.add_handler(id, Toggly.SystemMetrics.LogHandler, config) do
          :ok -> :ok
          {:error, _} -> :ok
        end

      {:error, _} ->
        :ok
    end
  end

  def detach_exception_handler(client_name) do
    id = handler_id(client_name)
    _ = :logger.remove_handler(id)
    :ok
  end

  # logger handler ids must be atoms
  defp handler_id(name) when is_atom(name), do: :"toggly.system_metrics.#{name}"
  defp handler_id(name), do: :"toggly.system_metrics.#{inspect(name)}"

  defp maybe_add(samples, _metric, nil), do: samples
  defp maybe_add(samples, metric, value) when is_number(value), do: [{metric, value} | samples]

  defp maybe_add_exception(samples, 0), do: samples

  defp maybe_add_exception(samples, count) when count > 0,
    do: [{"ExceptionCount", count * 1.0} | samples]

  defp sample_cpu(prev) do
    next = cpu_snapshot()

    pct =
      case prev do
        {prev_rt, prev_wc} when is_integer(prev_rt) and is_integer(prev_wc) ->
          {rt, wc} = next
          run_delta = rt - prev_rt
          wall_delta = max(wc - prev_wc, 1)
          schedulers = max(:erlang.system_info(:schedulers_online), 1)
          value = run_delta / wall_delta / schedulers * 100.0

          cond do
            value < 0 -> nil
            value > 100.0 -> 100.0
            true -> value
          end

        _ ->
          nil
      end

    {pct, next}
  rescue
    _ -> {nil, prev || {0, 0}}
  end

  defp sample_gc_heap do
    :erlang.memory(:total) * 1.0
  rescue
    _ -> nil
  end

  defp sample_process_count do
    :erlang.system_info(:process_count) * 1.0
  rescue
    _ -> nil
  end

  defp sample_memory_working_set do
    case :os.type() do
      {:unix, :linux} -> read_linux_vm_rss()
      _ -> nil
    end
  end

  defp read_linux_vm_rss do
    case File.read("/proc/self/status") do
      {:ok, content} -> parse_vm_rss(content)
      _ -> nil
    end
  rescue
    _ -> nil
  end

  @doc false
  def parse_vm_rss(content) when is_binary(content) do
    content
    |> String.split("\n", trim: true)
    |> Enum.find_value(fn
      "VmRSS:" <> rest ->
        case Integer.parse(String.trim(rest)) do
          {kb, _} -> kb * 1024.0
          :error -> nil
        end

      _ ->
        nil
    end)
  end
end

defmodule Toggly.SystemMetrics.LogHandler do
  @moduledoc false
  @behaviour :logger_handler

  @impl :logger_handler
  def log(%{msg: {:report, report}}, config) when is_map(report) do
    client = handler_client(config)

    if crash_report?(report) and is_pid(client) and Process.alive?(client) do
      GenServer.cast(client, :system_metrics_exception)
    end

    :ok
  end

  def log(_event, _config), do: :ok

  defp handler_client(%{config: %{client: client}}), do: client
  defp handler_client(%{client: client}), do: client
  defp handler_client(_), do: nil

  defp crash_report?(report) do
    kind =
      case report do
        %{kind: kind} -> kind
        %{label: {:proc_lib, :crash}} -> :crash_report
        report when is_list(report) -> Keyword.get(report, :kind) || Keyword.get(report, :label)
        _ -> nil
      end

    kind in [:crash_report, {:proc_lib, :crash}]
  end
end
