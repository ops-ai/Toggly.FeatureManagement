defmodule Toggly.Snapshot do
  @moduledoc false
  def read(nil), do: {:error, :disabled}
  def read(path), do: File.read(path)
  def write(nil, _), do: :ok

  def write(path, body) do
    temporary = path <> ".#{System.unique_integer([:positive])}.tmp"

    with :ok <- File.mkdir_p(Path.dirname(path)),
         :ok <- File.write(temporary, body, [:exclusive]),
         :ok <- File.chmod(temporary, 0o600),
         :ok <- File.rename(temporary, path) do
      :ok
    else
      error ->
        File.rm(temporary)
        error
    end
  end
end
