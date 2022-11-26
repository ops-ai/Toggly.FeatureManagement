using System;
using System.Security.Cryptography;

namespace Toggly.FeatureManagement
{
    internal class Hashing
    {
        public static string GetStringSha256Hash(string text)
        {
            if (string.IsNullOrEmpty(text))
                return string.Empty;

            using (var sha = SHA256.Create())
            {
                var textData = System.Text.Encoding.UTF8.GetBytes(text);
                var hash = sha.ComputeHash(textData);
                return BitConverter.ToString(hash).Replace("-", string.Empty);
            }
        }
    }
}
