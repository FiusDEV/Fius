class Fius < Formula
  desc "Your command center for controlling computers and services with natural language"
  homepage "https://fius.dev"
  url "https://registry.npmjs.org/@fiusdev/fius/-/fiusdev-fius-#{version}.tgz"
  version "1.0.0"
  license "MIT"

  depends_on "node@20"

  def install
    system "npm", "install", "-g", "@fiusdev/fius@#{version}"
    bin.install_symlink Dir["#{libnode_modules}/fiusdev/fius/bin/*"]
  end

  def libnode_modules
    HOMEBREW_PREFIX/"lib/node_modules/@fiusdev/fius"
  end

  test do
    assert_match "fius", shell_output("#{bin}/fius --version")
  end
end
