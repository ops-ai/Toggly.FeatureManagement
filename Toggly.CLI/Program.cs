using System.CommandLine;
using Toggly.CLI;

return await CliApplication.CreateRootCommand().InvokeAsync(args);

