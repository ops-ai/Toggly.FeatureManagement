defmodule Toggly.SystemMetrics do
  @moduledoc false

  @interval_ms 10_000
  @max_pending 30

  def interval_ms(opts), do: Keyword.get(opts, :system_metrics_interval_ms, @interval_ms)

  def max_pending, do: @max_pending

  @type sample :: {String.t(), number()}

  @doc """
  Default process samples. `exception_count` is consumed (zeroed in the returned count).
  """
  @spec default_sample(non_neg_integer()) :: {non_neg_integer(), [sample()]}
  def default_sample(exception_count) do
    samples =
      []
      |> maybe_add("CpuUsage", sample_cpu())
      |> maybe_add("GCHeapSize", sample_gc_heap())
      |> maybe_add("ProcessCount", sample_process_count())
      |> maybe_add("MemoryWorkingSet", sample_memory_working_set())
      |> maybe_add_exception(exception_count)

    {0, samples}
  end

  def attach_exception_handler(client_name, client_pid) do
    id = handler_id(client_name)
    config = %{config: %{client: client_pid}}

    case :logger.add_handler(id, Toggly.SystemMetrics.LogHandler, config) do
      :ok ->
        :ok

      {:error, {:already_exists, _}} ->
        # Client may have crashed without terminate/2; refresh the PID so
        # ExceptionCount keeps routing to the live GenServer.
        _ = :logger.update_handler_config(id, config)
        :ok

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

  defp sample_cpu do
    {_total_rt, run_delta} = :erlang.statistics(:runtime)
    {_total_wc, wall_delta} = :erlang.statistics(:wall_clock)
    schedulers = max(:erlang.system_info(:schedulers_online), 1)
    wall = max(wall_delta, 1)
    pct = run_delta / wall / schedulers * 100.0

    if pct >= 0 and pct <= 100, do: pct, else: nil
  rescue
    _ -> nil
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
