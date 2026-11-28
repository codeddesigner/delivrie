# frozen_string_literal: true

require_relative "lib/delivrie/version"

Gem::Specification.new do |s|
  s.name = "delivrie"
  s.version = Delivrie::VERSION
  s.summary = "Ruby client for the Delivrie email API"
  s.description = "Send transactional email and broadcasts, manage domains, contacts, templates and automations, work the Inbox and verify webhooks with Delivrie. No runtime dependencies."
  s.authors = ["Surce Inc"]
  s.email = "support@delivrie.io"
  s.homepage = "https://delivrie.io/docs/ruby"
  s.license = "MIT"
  s.required_ruby_version = ">= 3.1"
  s.files = Dir["lib/**/*.rb"] + %w[README.md LICENSE]
  s.require_paths = ["lib"]
  s.metadata = {
    "homepage_uri" => "https://delivrie.io/docs/ruby",
    "documentation_uri" => "https://delivrie.io/docs/ruby",
    "source_code_uri" => "https://github.com/bysurce/delivrie/tree/main/sdk/ruby",
    "changelog_uri" => "https://delivrie.io/changelog",
    "rubygems_mfa_required" => "true",
  }
end
