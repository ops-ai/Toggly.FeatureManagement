using System;
using System.Threading;

namespace Toggly.FeatureManagement.Web
{
    static class RandomGenerator
    {
        private static Random _global = new Random();

        private static ThreadLocal<Random> _rnd = new ThreadLocal<Random>(() =>
        {
            int seed;

            lock (_global)
            {
                seed = _global.Next();
            }

            return new Random(seed);
        });

        public static int Next()
        {
            return _rnd.Value.Next();
        }

        public static double NextDouble()
        {
            return _rnd.Value.NextDouble();
        }
    }
}
