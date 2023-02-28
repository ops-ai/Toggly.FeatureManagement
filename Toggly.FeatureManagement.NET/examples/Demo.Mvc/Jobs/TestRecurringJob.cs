namespace Demo.Mvc.Jobs
{
    public class TestRecurringJob : ITestRecurringJob
    {
        public async Task RunAsync()
        {
            await Task.Delay(1000);
        }
    }
}
