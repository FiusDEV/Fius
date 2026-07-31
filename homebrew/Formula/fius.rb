class Fius < Formula
  desc "Your command center for controlling computers and services with natural language"
  homepage "https://fius.dev"
  url "https://registry.npmjs.org/fius/-/fius-#{version}.tgz"
  version "1.0.0"
  license "Elastic-2.0"

  depends_on "node@20"

  def install
    system "npm", "install", "-g", "fius@#{version}"
    bin.install_symlink Dir["#{libnode_modules}/fius/bin/*"]
  end

  def libnode_modules
    HOMEBREW_PREFIX/"lib/node_modules/fius"
  end

  test do
    assert_match "fius", shell_output("#{bin}/fius --version")
  end
end
