using System.IO;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// ECDSA signature
    /// </summary>
    public class EcdsaSignature
    {
        /// <summary>
        /// R
        /// </summary>
        public byte[] R { get; }

        /// <summary>
        /// S
        /// </summary>
        public byte[] S { get; }

        /// <summary>
        /// Constructor
        /// </summary>
        public EcdsaSignature(byte[] r, byte[] s)
        {
            R = r;
            S = s;
        }

        /// <summary>
        /// To byte array
        /// </summary>
        /// <returns></returns>
        public byte[] ToByteArray()
        {
            var ms = new MemoryStream();

            var writer = new BinaryWriter(ms);

            // Write sequence tag and length
            writer.Write((byte)0x30);
            var totalLen = R.Length + S.Length + 4;
            writer.Write((byte)totalLen);

            // Write R
            writer.Write((byte)0x02);
            writer.Write((byte)R.Length);
            writer.Write(R);

            // Write S
            writer.Write((byte)0x02);
            writer.Write((byte)S.Length);
            writer.Write(S);

            return ms.ToArray();
        }
    }
}