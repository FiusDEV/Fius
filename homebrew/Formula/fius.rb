class Fius < Formula
  desc "Your command center for controlling computers and services with natural language"
  homepage "https://fius.dev"
  url "https://registry.npmjs.org/@fiusdev/fius/-/fius-#{version}.tgz"
  version "1.0.10"
  license "MIT"

  depends_on "node@20"

  def install
    system "npm", "install", "-g", "--prefix", libexec, "@fiusdev/fius@#{version}"
    bin.install_symlink Dir["#{libexec}/bin/*"]
    libexec.install_symlink libexec/"lib/node_modules/@fiusdev/fius"
  end

  test do
    assert_match "1.0.10", shell_output("#{bin}/fius --version")
  end
end
